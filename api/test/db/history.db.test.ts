import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, type Db } from "./harness.js";

// T6 against a real Postgres: the trigger, update_versioned and the read policies. The fakes
// in api/test cannot run triggers or row-level security, which is where the first version of
// T6 failed while every fake test passed.

let db: Db;
let owner: string;
let manager: string;
let worker: string;

type History = {
  reason: string;
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  changed_by: string;
};

beforeAll(async () => {
  db = await migratedDb();
  owner = await db.user("owner");
  manager = await db.user("manager");
  worker = await db.user("worker");
}, 60_000);

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0];

const historyOf = async (rowId: string) =>
  (
    await db.query<History>("SELECT * FROM history WHERE row_id = $1 ORDER BY changed_at, id", [
      rowId,
    ])
  ).rows;

async function newMine() {
  return one<{ id: string; version: number }>(
    "INSERT INTO mines (name, location, team_name) VALUES ('Kriel Pit', 'Mpumalanga', 'Alpha') RETURNING id, version",
  );
}

/** update_versioned as a signed-in user, the way the API calls it with the caller's token. */
const updateAs = (
  userId: string,
  table: string,
  id: string,
  patch: object,
  version: number,
  reason: string | null,
) =>
  db.as(userId, (tx) =>
    tx.query<{ row: Record<string, unknown> | null }>(
      "SELECT update_versioned($1, $2, $3, $4, $5) AS row",
      [table, id, JSON.stringify(patch), version, reason],
    ),
  );

describe("T6: a change through the API is recorded with its reason", () => {
  it("writes one row with the reason, the person, and only the columns that changed", async () => {
    const mine = await newMine();
    const { rows } = await updateAs(
      owner,
      "mines",
      mine.id,
      { team_name: "Bravo" },
      mine.version,
      "  Crew swapped sites ",
    );

    expect(rows[0].row).toMatchObject({ team_name: "Bravo", version: mine.version + 1 });
    const history = await historyOf(mine.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      reason: "Crew swapped sites",
      changed_by: owner,
      old_values: { team_name: "Alpha" },
      new_values: { team_name: "Bravo" },
    });
  });

  it("refuses a change with no reason, and changes nothing", async () => {
    const mine = await newMine();
    for (const reason of [null, "", "   "]) {
      await expect(
        updateAs(owner, "mines", mine.id, { name: "X" }, mine.version, reason),
      ).rejects.toThrow("A reason is required when changing a record");
    }
    expect(
      (await one<{ name: string }>("SELECT name FROM mines WHERE id = $1", [mine.id])).name,
    ).toBe("Kriel Pit");
    expect(await historyOf(mine.id)).toHaveLength(0);
  });

  it("can clear a field by sending null", async () => {
    const mine = await newMine();
    const { rows } = await updateAs(
      owner,
      "mines",
      mine.id,
      { location: null },
      mine.version,
      "Site closed down",
    );
    expect(rows[0].row).toMatchObject({ location: null });
    expect((await historyOf(mine.id))[0].new_values).toEqual({ location: null });
  });

  it("returns nothing and records nothing for an out-of-date version", async () => {
    const mine = await newMine();
    const { rows } = await updateAs(
      owner,
      "mines",
      mine.id,
      { name: "Late" },
      mine.version + 5,
      "Too late",
    );
    expect(rows[0].row).toBeNull();
    expect(await historyOf(mine.id)).toHaveLength(0);
  });

  it("works for every versioned table, not only the ones with their own function", async () => {
    const mine = await newMine();
    const log = await one<{ id: string; version: number }>(
      "INSERT INTO production_logs (mine_id, tons_produced) VALUES ($1, 300) RETURNING id, version",
      [mine.id],
    );
    const { rows } = await updateAs(
      owner,
      "production_logs",
      log.id,
      { tons_produced: 310 },
      log.version,
      "Weighbridge slip corrected",
    );
    expect(Number(rows[0].row?.tons_produced)).toBe(310);
    expect((await historyOf(log.id))[0].reason).toBe("Weighbridge slip corrected");
  });

  it("refuses a table without versions, and the history table itself", async () => {
    const mine = await newMine();
    await expect(updateAs(owner, "user_roles", mine.id, {}, 1, "x")).rejects.toThrow(
      "cannot be changed this way",
    );
    await expect(updateAs(owner, "history", mine.id, {}, 1, "x")).rejects.toThrow(
      "cannot be changed this way",
    );
  });
});

describe("T6: changes that do not come through the API still work, and are still recorded", () => {
  it("logging a repair part still takes it off stock, recorded as automatic", async () => {
    const eq = await one<{ id: string }>(
      "INSERT INTO equipment (name) VALUES ('CV-201') RETURNING id",
    );
    const log = await one<{ id: string }>(
      "INSERT INTO maintenance_logs (equipment_id, description) VALUES ($1, 'Belt') RETURNING id",
      [eq.id],
    );
    const item = await one<{ id: string }>(
      "INSERT INTO stock_items (name, qty_on_hand, unit_cost, plant) VALUES ('Bearing', 10, 100, 'A') RETURNING id",
    );

    await db.query(
      "INSERT INTO maintenance_parts (maintenance_id, stock_item_id, qty, unit_cost) VALUES ($1, $2, 3, 100)",
      [log.id, item.id],
    );

    expect(
      Number(
        (await one<{ q: string }>("SELECT qty_on_hand q FROM stock_items WHERE id = $1", [item.id]))
          .q,
      ),
    ).toBe(7);
    const history = await historyOf(item.id);
    expect(history[0].reason).toMatch(/^Automatic/);
    expect(history[0].new_values).toMatchObject({ qty_on_hand: 7 });
  });

  it("receiving a purchase order straight in Supabase still adds to stock", async () => {
    const item = await one<{ id: string }>(
      "INSERT INTO stock_items (name, qty_on_hand, unit_cost, plant) VALUES ('Belt', 2, 100, 'A') RETURNING id",
    );
    const po = await one<{ id: string }>(
      "INSERT INTO purchase_orders (status, plant) VALUES ('ordered', 'A') RETURNING id",
    );
    await db.query(
      "INSERT INTO po_lines (po_id, stock_item_id, qty, unit_cost) VALUES ($1, $2, 5, 100)",
      [po.id, item.id],
    );

    await db.query("UPDATE purchase_orders SET status = 'received' WHERE id = $1", [po.id]);

    expect(
      Number(
        (await one<{ q: string }>("SELECT qty_on_hand q FROM stock_items WHERE id = $1", [item.id]))
          .q,
      ),
    ).toBe(7);
    expect((await historyOf(po.id)).at(-1)?.reason).toMatch(/^Not given/);
    expect((await historyOf(item.id)).at(-1)?.reason).toMatch(/^Automatic/);
  });

  it("a stock change set off by an API change carries that change's reason", async () => {
    const item = await one<{ id: string }>(
      "INSERT INTO stock_items (name, qty_on_hand, unit_cost, plant) VALUES ('Liner', 1, 100, 'A') RETURNING id",
    );
    const po = await one<{ id: string; version: number }>(
      "INSERT INTO purchase_orders (status, plant) VALUES ('ordered', 'A') RETURNING id, version",
    );
    await db.query(
      "INSERT INTO po_lines (po_id, stock_item_id, qty, unit_cost) VALUES ($1, $2, 4, 100)",
      [po.id, item.id],
    );
    const v = (
      await one<{ version: number }>("SELECT version FROM purchase_orders WHERE id = $1", [po.id])
    ).version;

    await updateAs(
      owner,
      "purchase_orders",
      po.id,
      { status: "received" },
      v,
      "Delivery checked at the gate",
    );

    expect((await historyOf(item.id)).at(-1)?.reason).toBe("Delivery checked at the gate");
  });

  it("an edit straight against Supabase is recorded as not given, not refused", async () => {
    const client = await one<{ id: string }>(
      "INSERT INTO clients (name) VALUES ('Seriti') RETURNING id",
    );
    await db.as(owner, (tx) =>
      tx.query("UPDATE clients SET name = 'Seriti Coal' WHERE id = $1", [client.id]),
    );
    const history = await historyOf(client.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      reason: "Not given: changed outside the API",
      changed_by: owner,
    });
  });
});

describe("T6: who can read and change the history", () => {
  it("the owner reads every change, a worker reads none", async () => {
    const mine = await newMine();
    await updateAs(owner, "mines", mine.id, { name: "Read me" }, mine.version, "For the read test");
    const count = (userId: string) =>
      db.as(userId, (tx) =>
        tx.query<{ n: number }>("SELECT count(*)::int n FROM history WHERE row_id = $1", [mine.id]),
      );
    expect((await count(owner)).rows[0].n).toBe(1);
    expect((await count(worker)).rows[0].n).toBe(0);
    // Mines carry no plant, so a manager does not see them.
    expect((await count(manager)).rows[0].n).toBe(0);
  });

  it("nobody signed in can add, change or remove a history row", async () => {
    const mine = await newMine();
    await updateAs(owner, "mines", mine.id, { name: "Locked" }, mine.version, "For the lock test");
    for (const sql of [
      "INSERT INTO history (table_name, row_id, changed_by, reason, version) VALUES ('mines', gen_random_uuid(), auth.uid(), 'forged', 1)",
      "UPDATE history SET reason = 'rewritten'",
      "DELETE FROM history",
    ]) {
      await expect(db.as(owner, (tx) => tx.query(sql))).rejects.toThrow();
    }
    expect((await historyOf(mine.id))[0].reason).toBe("For the lock test");
  });
});
