import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, type Db } from "./harness.js";

// T10 part B against a real Postgres: a report is made, a late entry lands in its month, and the
// report shows as out of date. Months are worked out from today, so the test does not age.

let db: Db;
let owner: string;
let manager: string;
let worker: string;
let lastMonth: string; // YYYY-MM-01, a month that has ended
let thisMonth: string; // YYYY-MM-01, the month still running

beforeAll(async () => {
  db = await migratedDb();
  owner = await db.user("owner");
  manager = await db.user("manager");
  worker = await db.user("worker");
  const m = await db.query<{ last: string; now: string }>(
    `SELECT to_char(date_trunc('month', now() - interval '1 month'), 'YYYY-MM-DD') AS last,
            to_char(date_trunc('month', now()), 'YYYY-MM-DD') AS now`,
  );
  lastMonth = m.rows[0].last;
  thisMonth = m.rows[0].now;
}, 60_000);

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0];
const day = (month: string, d: number) => `${month.slice(0, 8)}${String(d).padStart(2, "0")}`;

async function newMine(name: string) {
  return (await one<{ id: string }>("INSERT INTO mines (name) VALUES ($1) RETURNING id", [name]))
    .id;
}
const makeReport = (userId: string, mine: string, month: string) =>
  db.as(userId, (tx) =>
    tx.query<{ previous_stale_since: string | null; month_complete: boolean }>(
      "SELECT * FROM record_report_run($1, $2)",
      [mine, month],
    ),
  );
const run = (mine: string, month: string) =>
  one<{ stale_since: string | null; stale_reason: string | null; month_complete: boolean }>(
    "SELECT stale_since, stale_reason, month_complete FROM report_runs WHERE mine_id = $1 AND month = $2",
    [mine, month],
  );

describe("T10: a report that received a late entry shows as out of date", () => {
  it("makes a report, sends a late entry, then the report is flagged", async () => {
    const mine = await newMine("Kriel Pit");
    await makeReport(manager, mine, lastMonth);
    expect((await run(mine, lastMonth)).stale_since).toBeNull();

    // A worker captures a production entry dated last month, inside the 60-day limit.
    await db.as(worker, (tx) =>
      tx.query("INSERT INTO production_logs (mine_id, date, tons_produced) VALUES ($1, $2, 120)", [
        mine,
        day(lastMonth, 20),
      ]),
    );

    const flagged = await run(mine, lastMonth);
    expect(flagged.stale_since).not.toBeNull();
    expect(flagged.stale_reason).toMatch(
      /^A production entry dated \d+ \w+ \d{4} was added after this report was made\.$/,
    );
  });

  it("is flagged by every kind of entry the report reads, and by corrections and removals", async () => {
    const mine = await newMine("Ogies Pit");
    const equipment = (
      await one<{ id: string }>(
        "INSERT INTO equipment (name, mine_id) VALUES ('CV-1', $1) RETURNING id",
        [mine],
      )
    ).id;
    const cases: [string, string, unknown[]][] = [
      [
        "fuel slip",
        "INSERT INTO fuel_slips (mine_id, date, litres, cost_per_litre) VALUES ($1, $2, 10, 20)",
        [mine, day(lastMonth, 3)],
      ],
      [
        "repair",
        "INSERT INTO maintenance_logs (equipment_id, date, description) VALUES ($1, $2, 'Belt')",
        [equipment, day(lastMonth, 4)],
      ],
      [
        "downtime entry",
        "INSERT INTO downtime_events (mine_id, reason, duration_hours, start_time) VALUES ($1, 'breakdown', 2, $2::date + time '10:00')",
        [mine, day(lastMonth, 5)],
      ],
      [
        "fixed cost",
        "INSERT INTO static_costs (mine_id, month, category, amount) VALUES ($1, $2, 'rent', 500)",
        [mine, lastMonth],
      ],
    ];
    for (const [label, sql, params] of cases) {
      await makeReport(owner, mine, lastMonth);
      await db.query(sql, params);
      expect((await run(mine, lastMonth)).stale_reason, label).toContain(`A ${label} dated`);
    }

    // A correction and a removal count too.
    const log = (
      await one<{ id: string }>(
        "INSERT INTO production_logs (mine_id, date, tons_produced) VALUES ($1, $2, 50) RETURNING id",
        [mine, day(lastMonth, 6)],
      )
    ).id;
    await makeReport(owner, mine, lastMonth);
    await db.query("UPDATE production_logs SET tons_produced = 55 WHERE id = $1", [log]);
    expect((await run(mine, lastMonth)).stale_reason).toContain("was changed");
    await makeReport(owner, mine, lastMonth);
    await db.query("DELETE FROM production_logs WHERE id = $1", [log]);
    expect((await run(mine, lastMonth)).stale_reason).toContain("was removed");
  });

  it("leaves other months and other sites alone", async () => {
    const mine = await newMine("Witbank Pit");
    const other = await newMine("Delmas Pit");
    await makeReport(owner, mine, lastMonth);
    await db.query(
      "INSERT INTO production_logs (mine_id, date, tons_produced) VALUES ($1, $2, 10)",
      [other, day(lastMonth, 8)],
    );
    await db.query(
      "INSERT INTO production_logs (mine_id, date, tons_produced) VALUES ($1, $2, 10)",
      [mine, day(thisMonth, 1)],
    );
    expect((await run(mine, lastMonth)).stale_since).toBeNull();
  });

  it("marks every site's report when a company-wide fixed cost lands in the month", async () => {
    const a = await newMine("Site A");
    const b = await newMine("Site B");
    await makeReport(owner, a, lastMonth);
    await makeReport(owner, b, lastMonth);
    await db.query(
      "INSERT INTO static_costs (mine_id, month, category, amount) VALUES (NULL, $1, 'insurance', 900)",
      [lastMonth],
    );
    expect((await run(a, lastMonth)).stale_since).not.toBeNull();
    expect((await run(b, lastMonth)).stale_since).not.toBeNull();
  });

  it("does not mark a report of the month still running, which is expected to change", async () => {
    const mine = await newMine("Running Pit");
    await makeReport(owner, mine, thisMonth);
    expect((await run(mine, thisMonth)).month_complete).toBe(false);
    await db.query(
      "INSERT INTO production_logs (mine_id, date, tons_produced) VALUES ($1, $2, 10)",
      [mine, day(thisMonth, 1)],
    );
    expect((await run(mine, thisMonth)).stale_since).toBeNull();
  });

  it("is current again once the report is made again, and says what had gone out of date", async () => {
    const mine = await newMine("Redo Pit");
    await makeReport(owner, mine, lastMonth);
    await db.query(
      "INSERT INTO production_logs (mine_id, date, tons_produced) VALUES ($1, $2, 10)",
      [mine, day(lastMonth, 9)],
    );
    const again = await makeReport(owner, mine, lastMonth);
    expect(again.rows[0].previous_stale_since).not.toBeNull();
    expect((await run(mine, lastMonth)).stale_since).toBeNull();
  });

  it("lets only owners and managers make reports, and only they can read the runs", async () => {
    const mine = await newMine("Locked Pit");
    await expect(makeReport(worker, mine, lastMonth)).rejects.toThrow(/Only owners and managers/);
    await makeReport(owner, mine, lastMonth);
    const seen = await db.as(worker, (tx) =>
      tx.query("SELECT * FROM report_runs WHERE mine_id = $1", [mine]),
    );
    expect(seen.rows).toHaveLength(0);
    await expect(
      db.as(manager, (tx) =>
        tx.query("UPDATE report_runs SET stale_since = NULL WHERE mine_id = $1", [mine]),
      ),
    ).rejects.toThrow();
  });
});
