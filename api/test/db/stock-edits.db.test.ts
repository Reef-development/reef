import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, type Db } from "./harness.js";

// T14A against a real Postgres: a stock item and a stock level are edited the way the API now
// edits them, through update_versioned with a reason, and T14's plant rule still decides who may.

let db: Db;
let kriel: string; // a manager at Kriel
let ogies: string; // a manager at Ogies

beforeAll(async () => {
  db = await migratedDb();
  kriel = await db.user("manager");
  ogies = await db.user("manager");
  await db.query("INSERT INTO plants (name) VALUES ('Kriel'), ('Ogies') ON CONFLICT DO NOTHING");
  await db.transaction(async (tx) => {
    await tx.query("SELECT set_config('request.jwt.claim.role', 'service_role', true)");
    await tx.query("UPDATE profiles SET plant = 'Kriel' WHERE id = $1", [kriel]);
    await tx.query("UPDATE profiles SET plant = 'Ogies' WHERE id = $1", [ogies]);
  });
}, 60_000);

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0];

async function krielPart() {
  const item = await one<{ id: string; version: number }>(
    "INSERT INTO stock_items (name, plant, unit_cost) VALUES ('Idler', 'Kriel', 100) RETURNING id, version",
  );
  const level = await one<{ id: string; version: number }>(
    "INSERT INTO stock_levels (stock_item_id, plant, qty_on_hand, reorder_point) VALUES ($1, 'Kriel', 10, 4) RETURNING id, version",
    [item.id],
  );
  return { item, level };
}

const updateAs = (
  userId: string,
  table: string,
  id: string,
  patch: object,
  version: number,
  reason: string,
) =>
  db.as(userId, (tx) =>
    tx.query<{ row: Record<string, unknown> | null }>(
      "SELECT update_versioned($1, $2, $3, $4, $5) AS row",
      [table, id, JSON.stringify(patch), version, reason],
    ),
  );

describe("T14A: stock levels carry a version, like every other editable record", () => {
  it("starts at 1 and rises on every save", async () => {
    const { level } = await krielPart();
    expect(level.version).toBe(1);
    await db.query("UPDATE stock_levels SET qty_on_hand = 9 WHERE id = $1", [level.id]);
    expect(
      (await one<{ version: number }>("SELECT version FROM stock_levels WHERE id = $1", [level.id]))
        .version,
    ).toBe(2);
  });
});

describe("T14A: a manager edits their plant's stock with a reason, and it is recorded", () => {
  it("changes a level's quantity and reorder point, with the reason in the history", async () => {
    const { level } = await krielPart();
    const { rows } = await updateAs(
      kriel,
      "stock_levels",
      level.id,
      { qty_on_hand: 7, reorder_point: 5 },
      1,
      "Recount after the stocktake",
    );
    expect(rows[0].row).toMatchObject({ qty_on_hand: 7, reorder_point: 5, version: 2 });
    const history = await one<{ reason: string; plant: string; new_values: object }>(
      "SELECT reason, plant, new_values FROM history WHERE row_id = $1 ORDER BY changed_at DESC LIMIT 1",
      [level.id],
    );
    expect(history).toMatchObject({
      reason: "Recount after the stocktake",
      plant: "Kriel",
      new_values: { qty_on_hand: 7, reorder_point: 5 },
    });
  });

  it("changes a stock item's price, with the reason in the history", async () => {
    const { item } = await krielPart();
    // Adding the level copied its quantity onto the item (kept in step for the prototype),
    // which counts as a save, so read the version the item has now.
    const { version } = await one<{ version: number }>(
      "SELECT version FROM stock_items WHERE id = $1",
      [item.id],
    );
    const { rows } = await updateAs(
      kriel,
      "stock_items",
      item.id,
      { unit_cost: 120 },
      version,
      "Supplier put the price up",
    );
    expect(Number(rows[0].row?.unit_cost)).toBe(120);
    const history = await one<{ reason: string }>(
      "SELECT reason FROM history WHERE row_id = $1 ORDER BY changed_at DESC LIMIT 1",
      [item.id],
    );
    expect(history.reason).toBe("Supplier put the price up");
  });

  it("changes nothing at another plant", async () => {
    const { item, level } = await krielPart();
    expect(
      (await updateAs(ogies, "stock_levels", level.id, { qty_on_hand: 0 }, 1, "Not mine")).rows[0]
        .row,
    ).toBeNull();
    expect(
      (await updateAs(ogies, "stock_items", item.id, { unit_cost: 1 }, item.version, "Not mine"))
        .rows[0].row,
    ).toBeNull();
    expect(
      Number(
        (
          await one<{ q: string }>("SELECT qty_on_hand q FROM stock_levels WHERE id = $1", [
            level.id,
          ])
        ).q,
      ),
    ).toBe(10);
  });
});
