import { beforeAll, describe, expect, it } from "vitest";
import { reefToday } from "@reef/shared";
import { migratedDb, type Db } from "./harness.js";

let db: Db;
let worker: string;
let manager: string;
let owner: string;
let mineId: string;

/** A date `days` before today in REEF's time zone, as the database will see it. */
const daysAgo = (days: number) => {
  const d = new Date(`${reefToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

const captureProduction = (userId: string, date: string) =>
  db.as(userId, (tx) =>
    tx.query("INSERT INTO production_logs (mine_id, date, tons_produced) VALUES ($1, $2, 100)", [
      mineId,
      date,
    ]),
  );

beforeAll(async () => {
  db = await migratedDb();
  worker = await db.user("worker");
  manager = await db.user("manager");
  owner = await db.user("owner");
  mineId = (
    await db.query<{ id: string }>("INSERT INTO mines (name) VALUES ('Kriel') RETURNING id")
  ).rows[0].id;
}, 60_000);

describe("T10: the capture age limit in the database", () => {
  it("starts at 60 days", async () => {
    const { rows } = await db.query<{ n: number }>("SELECT capture_max_age_days() AS n");
    expect(rows[0].n).toBe(60);
  });

  it("accepts an entry exactly 60 days old and refuses one 61 days old, with a reason", async () => {
    await expect(captureProduction(worker, daysAgo(60))).resolves.toBeDefined();
    await expect(captureProduction(worker, daysAgo(61))).rejects.toThrow(
      /which is 61 days ago.*older than 60 days/,
    );
  });

  it("applies to managers and owners too, not only workers", async () => {
    await expect(captureProduction(manager, daysAgo(90))).rejects.toThrow(/older than 60 days/);
    await expect(captureProduction(owner, daysAgo(90))).rejects.toThrow(/older than 60 days/);
  });

  it("guards fuel slips and repairs as well, including a repair saved with its parts", async () => {
    await expect(
      db.as(worker, (tx) =>
        tx.query(
          "INSERT INTO fuel_slips (date, litres, cost_per_litre, vehicle_label) VALUES ($1, 50, 22, 'LDV 3')",
          [daysAgo(70)],
        ),
      ),
    ).rejects.toThrow(/older than 60 days/);
    const eq = (
      await db.query<{ id: string }>(
        "INSERT INTO equipment (name) VALUES ('Screen 2') RETURNING id",
      )
    ).rows[0].id;
    await expect(
      db.as(worker, (tx) =>
        tx.query("SELECT * FROM create_maintenance_log($1)", [
          JSON.stringify({ equipment_id: eq, description: "Old repair", date: daysAgo(70) }),
        ]),
      ),
    ).rejects.toThrow(/older than 60 days/);
  });

  it("does not limit data-loading scripts, which run outside a sign-in", async () => {
    await expect(
      db.query("INSERT INTO production_logs (mine_id, date, tons_produced) VALUES ($1, $2, 100)", [
        mineId,
        daysAgo(900),
      ]),
    ).resolves.toBeDefined();
  });

  it("does not stop a manager correcting an old entry", async () => {
    const old = await db.query<{ id: string }>(
      "INSERT INTO production_logs (mine_id, date, tons_produced) VALUES ($1, $2, 100) RETURNING id",
      [mineId, daysAgo(120)],
    );
    await expect(
      db.as(manager, (tx) =>
        tx.query("UPDATE production_logs SET tons_produced = 110 WHERE id = $1", [old.rows[0].id]),
      ),
    ).resolves.toBeDefined();
  });
});

describe("T10: the limit is a setting only the owner changes", () => {
  it("lets the owner raise it, and the new limit applies straight away", async () => {
    await db.as(owner, (tx) =>
      tx.query("UPDATE settings SET value = '90' WHERE key = 'capture_max_age_days'"),
    );
    await expect(captureProduction(worker, daysAgo(75))).resolves.toBeDefined();
    await db.as(owner, (tx) =>
      tx.query("UPDATE settings SET value = '60' WHERE key = 'capture_max_age_days'"),
    );
  });

  it("does not let a manager change it", async () => {
    await db.as(manager, (tx) =>
      tx.query("UPDATE settings SET value = '365' WHERE key = 'capture_max_age_days'"),
    );
    const { rows } = await db.query<{ n: number }>("SELECT capture_max_age_days() AS n");
    expect(rows[0].n).toBe(60);
  });

  it("refuses a limit that is not a whole number of days from 1 to 365", async () => {
    for (const bad of ["0", "366", "12.5", '"60"']) {
      await expect(
        db.as(owner, (tx) =>
          tx.query(`UPDATE settings SET value = '${bad}' WHERE key = 'capture_max_age_days'`),
        ),
      ).rejects.toThrow(/whole number of days from 1 to 365/);
    }
  });

  it("lets everyone signed in read the limit, because the capture forms need it", async () => {
    const { rows } = await db.as(worker, (tx) =>
      tx.query<{ value: number }>("SELECT value FROM settings WHERE key = 'capture_max_age_days'"),
    );
    expect(rows[0].value).toBe(60);
  });
});
