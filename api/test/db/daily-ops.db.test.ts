import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, type Db } from "./harness.js";

let db: Db;
let worker: string;
let manager: string;
let equipmentId: string;
let bearingId: string;

beforeAll(async () => {
  db = await migratedDb();
  worker = await db.user("worker");
  manager = await db.user("manager");
  // T14: stock belongs to a plant, and people use stock at their own plant.
  // Plants are a list since #57; a stock item or a person can only belong to one on it.
  await db.query("INSERT INTO plants (name) VALUES ('Kriel'), ('Ogies') ON CONFLICT DO NOTHING");
  // Only the service role may set someone's plant (T14), so do it as an admin would.
  await db.transaction(async (tx) => {
    await tx.query("SELECT set_config('request.jwt.claim.role', 'service_role', true)");
    await tx.query("UPDATE profiles SET plant = 'Kriel' WHERE id = ANY($1)", [[worker, manager]]);
  });
  const eq = await db.query<{ id: string }>(
    "INSERT INTO equipment (name) VALUES ('Screen 3') RETURNING id",
  );
  equipmentId = eq.rows[0].id;
  const sup = await db.query<{ id: string }>(
    "INSERT INTO suppliers (name) VALUES ('Bearings SA') RETURNING id",
  );
  const item = await db.query<{ id: string }>(
    `INSERT INTO stock_items (name, qty_on_hand, reorder_point, reorder_qty, unit_cost, supplier_id, plant)
     VALUES ('Bearing 6205', 10, 4, 20, 150, $1, 'Kriel') RETURNING id`,
    [sup.rows[0].id],
  );
  bearingId = item.rows[0].id;
}, 60_000);

/**
 * The quantity on hand at the item's own plant, from stock_levels, which T14 made the record.
 * stock_level_of makes the level from the item's figures if no rule has needed one yet.
 */
const qty = async (id: string) =>
  Number(
    (await db.query<{ q: string }>("SELECT (stock_level_of($1)).qty_on_hand q", [id])).rows[0].q,
  );

describe("fuel slip totals", () => {
  it("works out the total from litres and price, ignoring any total the client sends", async () => {
    const { rows } = await db.as(worker, (tx) =>
      tx.query<{ total_cost: string }>(
        "INSERT INTO fuel_slips (litres, cost_per_litre, total_cost, logged_by) VALUES (120.5, 22.4, 1, auth.uid()) RETURNING total_cost",
      ),
    );
    expect(Number(rows[0].total_cost)).toBe(2699.2);
  });

  it("recalculates the total when the litres are corrected", async () => {
    const { rows } = await db.query<{ id: string }>(
      "INSERT INTO fuel_slips (litres, cost_per_litre) VALUES (100, 20) RETURNING id",
    );
    const upd = await db.query<{ total_cost: string }>(
      "UPDATE fuel_slips SET litres = 90 WHERE id = $1 RETURNING total_cost",
      [rows[0].id],
    );
    expect(Number(upd.rows[0].total_cost)).toBe(1800);
  });
});

describe("a repair and its parts, saved together", () => {
  it("saves the log and parts in one call, prices parts from stock, and totals labour + parts", async () => {
    const before = await qty(bearingId);
    const { rows } = await db.as(worker, (tx) =>
      tx.query<{ parts_cost: string; total_cost: string; logged_by: string }>(
        "SELECT * FROM create_maintenance_log($1, $2)",
        [
          JSON.stringify({
            equipment_id: equipmentId,
            description: "Replaced drive bearing",
            labour_cost: 400,
          }),
          JSON.stringify([{ stock_item_id: bearingId, qty: 2 }]),
        ],
      ),
    );
    expect(Number(rows[0].parts_cost)).toBe(300);
    expect(Number(rows[0].total_cost)).toBe(700);
    expect(rows[0].logged_by).toBe(worker);
    expect(await qty(bearingId)).toBe(before - 2);
  });

  it("saves nothing at all if one part is bad", async () => {
    const count = async () =>
      Number((await db.query<{ n: string }>("SELECT count(*) n FROM maintenance_logs")).rows[0].n);
    const before = await count();
    await expect(
      db.as(worker, (tx) =>
        tx.query("SELECT * FROM create_maintenance_log($1, $2)", [
          JSON.stringify({ equipment_id: equipmentId, description: "Half a repair" }),
          JSON.stringify([
            { stock_item_id: bearingId, qty: 1 },
            { stock_item_id: "not-a-uuid", qty: 1 },
          ]),
        ]),
      ),
    ).rejects.toThrow();
    expect(await count()).toBe(before);
  });

  it("records the caller as the person who logged it, whatever the client claims", async () => {
    const { rows } = await db.as(worker, (tx) =>
      tx.query<{ logged_by: string }>("SELECT * FROM create_maintenance_log($1)", [
        JSON.stringify({
          equipment_id: equipmentId,
          description: "Greased rollers",
          logged_by: manager,
        }),
      ]),
    );
    expect(rows[0].logged_by).toBe(worker);
  });

  it("puts a removed part back on the shelf and takes it off the repair's cost", async () => {
    const log = await db.as(manager, (tx) =>
      tx.query<{ id: string }>("SELECT * FROM create_maintenance_log($1, $2)", [
        JSON.stringify({
          equipment_id: equipmentId,
          description: "Wrong bearing fitted",
          labour_cost: 100,
        }),
        JSON.stringify([{ stock_item_id: bearingId, qty: 1 }]),
      ]),
    );
    const before = await qty(bearingId);
    await db.as(manager, (tx) =>
      tx.query("DELETE FROM maintenance_parts WHERE maintenance_id = $1", [log.rows[0].id]),
    );
    expect(await qty(bearingId)).toBe(before + 1);
    const after = await db.query<{ parts_cost: string; total_cost: string }>(
      "SELECT parts_cost, total_cost FROM maintenance_logs WHERE id = $1",
      [log.rows[0].id],
    );
    expect(Number(after.rows[0].parts_cost)).toBe(0);
    expect(Number(after.rows[0].total_cost)).toBe(100);
  });
});

describe("stock usage", () => {
  it("subtracts in one step and drafts a reorder when stock falls to the reorder point", async () => {
    const item = await db.query<{ id: string }>(
      "INSERT INTO stock_items (name, qty_on_hand, reorder_point, reorder_qty, unit_cost, plant) VALUES ('V-belt', 6, 4, 10, 80, 'Kriel') RETURNING id",
    );
    const id = item.rows[0].id;
    await db.as(worker, (tx) => tx.query("SELECT record_stock_usage($1, $2)", [id, 2]));
    expect(await qty(id)).toBe(4);
    const lines = await db.query<{ qty: string; status: string }>(
      "SELECT pl.qty, po.status FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id WHERE pl.stock_item_id = $1",
      [id],
    );
    expect(lines.rows).toHaveLength(1);
    expect(lines.rows[0]).toMatchObject({ status: "draft" });
    expect(Number(lines.rows[0].qty)).toBe(10);
  });

  it("does not draft a second order line for an item already on a draft order", async () => {
    const item = await db.query<{ id: string }>(
      "INSERT INTO stock_items (name, qty_on_hand, reorder_point, reorder_qty, unit_cost, plant) VALUES ('Filter', 3, 4, 5, 60, 'Kriel') RETURNING id",
    );
    const id = item.rows[0].id;
    await db.as(worker, (tx) => tx.query("SELECT record_stock_usage($1, 1)", [id]));
    await db.as(worker, (tx) => tx.query("SELECT record_stock_usage($1, 1)", [id]));
    const n = await db.query<{ n: string }>(
      "SELECT count(*) n FROM po_lines WHERE stock_item_id = $1",
      [id],
    );
    expect(Number(n.rows[0].n)).toBe(1);
  });

  it("adds up two usages instead of one overwriting the other", async () => {
    const item = await db.query<{ id: string }>(
      "INSERT INTO stock_items (name, qty_on_hand, reorder_point, reorder_qty, plant) VALUES ('Bolt', 100, 0, 0, 'Kriel') RETURNING id",
    );
    const id = item.rows[0].id;
    await Promise.all([
      db.as(worker, (tx) => tx.query("SELECT record_stock_usage($1, 7)", [id])),
      db.as(manager, (tx) => tx.query("SELECT record_stock_usage($1, 5)", [id])),
    ]);
    expect(await qty(id)).toBe(88);
  });

  it("refuses zero or negative quantities", async () => {
    await expect(
      db.as(worker, (tx) => tx.query("SELECT record_stock_usage($1, 0)", [bearingId])),
    ).rejects.toThrow(/more than zero/);
  });

  it("names an unknown item clearly", async () => {
    await expect(
      db.as(worker, (tx) =>
        tx.query("SELECT record_stock_usage($1, 1)", ["00000000-0000-4000-8000-000000000999"]),
      ),
    ).rejects.toThrow(/No such stock item/);
  });

  it("refuses someone with no role", async () => {
    const stranger = (
      await db.query<{ id: string }>(
        "INSERT INTO auth.users (email) VALUES ('x@test.local') RETURNING id",
      )
    ).rows[0].id;
    await db.query("DELETE FROM user_roles WHERE user_id = $1", [stranger]);
    await expect(
      db.as(stranger, (tx) => tx.query("SELECT record_stock_usage($1, 1)", [bearingId])),
    ).rejects.toThrow(/no role/);
  });
});

describe("T14: the stock rules work on each plant's own level", () => {
  const newItem = async (
    name: string,
    plant: string,
    onHand = 10,
    reorderPoint = 2,
    reorderQty = 5,
  ) => {
    const item = await db.query<{ id: string }>(
      `INSERT INTO stock_items
         (name, qty_on_hand, reorder_point, reorder_qty, plant)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [name, onHand, reorderPoint, reorderQty, plant],
    );

    return item.rows[0].id;
  };

  it("makes a level at the item's plant the first time a rule needs one", async () => {
    const id = await newItem("Sprocket", "Kriel", 10, 2, 5);

    await db.query("SELECT stock_level_of($1)", [id]);

    const level = await db.query<{
      plant: string;
      qty_on_hand: string;
      reorder_point: string;
      reorder_qty: string;
    }>(
      `SELECT plant, qty_on_hand, reorder_point, reorder_qty
       FROM stock_levels
       WHERE stock_item_id = $1`,
      [id],
    );

    expect(level.rows).toHaveLength(1);
    expect(level.rows[0].plant).toBe("Kriel");
    expect(Number(level.rows[0].qty_on_hand)).toBe(10);
    expect(Number(level.rows[0].reorder_point)).toBe(2);
    expect(Number(level.rows[0].reorder_qty)).toBe(5);
  });

  it("lets the API add an item and then its level, as T14's endpoints do", async () => {
    const item = await db.query<{ id: string }>(
      `INSERT INTO stock_items
         (name, qty_on_hand, reorder_point, reorder_qty, plant)
       VALUES ('API belt', 8, 3, 4, 'Kriel')
       RETURNING id`,
    );

    const id = item.rows[0].id;

    await db.query(
      `INSERT INTO stock_levels
         (stock_item_id, plant, qty_on_hand, reorder_point, reorder_qty)
       VALUES ($1, 'Kriel', 8, 3, 4)`,
      [id],
    );

    const level = await db.query<{ plant: string }>(
      `SELECT plant
       FROM stock_levels
       WHERE stock_item_id = $1`,
      [id],
    );

    expect(level.rows).toHaveLength(1);
    expect(level.rows[0].plant).toBe("Kriel");
  });

  it("refuses usage of another plant's item as not found, so it does not confirm it exists", async () => {
    const id = await newItem("Ogies chain", "Ogies");

    await expect(
      db.as(worker, (tx) => tx.query("SELECT record_stock_usage($1, 1)", [id])),
    ).rejects.toThrow(/No such stock item/);

    expect(await qty(id)).toBe(10);
  });

  it("raises a reorder on a draft for the item's plant", async () => {
    const id = await newItem("Seal kit", "Kriel", 3, 2, 6);

    await db.as(worker, (tx) => tx.query("SELECT record_stock_usage($1, 1)", [id]));

    const { rows } = await db.query<{ plant: string; qty: string }>(
      `SELECT po.plant, pl.qty
       FROM po_lines pl
       JOIN purchase_orders po ON po.id = pl.po_id
       WHERE pl.stock_item_id = $1`,
      [id],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].plant).toBe("Kriel");
    expect(Number(rows[0].qty)).toBe(6);
  });

  it("uses the plant's reorder point, not the old one on the item", async () => {
    const id = await newItem("Hose", "Kriel", 10, 2, 4);

    // A manager raises the reorder point on the level, as the T14 screens do.
    await db.query("SELECT stock_level_of($1)", [id]);

    await db.query("UPDATE stock_levels SET reorder_point = 9 WHERE stock_item_id = $1", [id]);

    await db.as(worker, (tx) => tx.query("SELECT record_stock_usage($1, 1)", [id]));

    const n = await db.query<{ n: string }>(
      "SELECT count(*) n FROM po_lines WHERE stock_item_id = $1",
      [id],
    );

    expect(Number(n.rows[0].n)).toBe(1);
  });

  it("adds a received delivery to the plant's level", async () => {
    const id = await newItem("Idler", "Kriel", 1, 0, 0);

    const po = await db.query<{ id: string }>(
      "INSERT INTO purchase_orders (plant) VALUES ('Kriel') RETURNING id",
    );

    await db.query(
      `INSERT INTO po_lines
         (po_id, stock_item_id, qty, unit_cost)
       VALUES ($1, $2, 8, 50)`,
      [po.rows[0].id, id],
    );

    // Lines go on while it is a draft; then it is approved and received.
    await db.query("UPDATE purchase_orders SET status = 'approved' WHERE id = $1", [po.rows[0].id]);

    await db.query("UPDATE purchase_orders SET status = 'received' WHERE id = $1", [po.rows[0].id]);

    expect(await qty(id)).toBe(9);
  });

  it("does not add the same received delivery to stock twice", async () => {
    const id = await newItem("Bearing", "Kriel", 1, 0, 0);

    const po = await db.query<{ id: string }>(
      "INSERT INTO purchase_orders (plant) VALUES ('Kriel') RETURNING id",
    );

    await db.query(
      `INSERT INTO po_lines
         (po_id, stock_item_id, qty, unit_cost)
       VALUES ($1, $2, 8, 50)`,
      [po.rows[0].id, id],
    );

    await db.query("UPDATE purchase_orders SET status = 'approved' WHERE id = $1", [po.rows[0].id]);

    await db.query("UPDATE purchase_orders SET status = 'received' WHERE id = $1", [po.rows[0].id]);

    expect(await qty(id)).toBe(9);

    await db.query("UPDATE purchase_orders SET status = 'received' WHERE id = $1", [po.rows[0].id]);

    expect(await qty(id)).toBe(9);
  });

  it("keeps the prototype's old quantity column equal to the level, both ways", async () => {
    const id = await newItem("Pulley", "Kriel", 20);

    await db.as(worker, (tx) => tx.query("SELECT record_stock_usage($1, 5)", [id]));

    const item = async () =>
      Number(
        (await db.query<{ q: string }>("SELECT qty_on_hand q FROM stock_items WHERE id = $1", [id]))
          .rows[0].q,
      );

    expect(await item()).toBe(15);

    // The prototype under src/ still writes stock_items directly.
    await db.query("UPDATE stock_items SET qty_on_hand = 30 WHERE id = $1", [id]);

    expect(await qty(id)).toBe(30);
  });
});

describe("T8 versions, in the real database", () => {
  it("raises the version on update and ignores a version the client tries to set", async () => {
    const m = await db.query<{ id: string; version: number }>(
      "INSERT INTO mines (name) VALUES ('Kriel') RETURNING id, version",
    );
    expect(m.rows[0].version).toBe(1);
    const u = await db.query<{ version: number }>(
      "UPDATE mines SET name = 'Kriel 2', version = 99 WHERE id = $1 RETURNING version",
      [m.rows[0].id],
    );
    expect(u.rows[0].version).toBe(2);
  });

  it("matches no row when the version is out of date, which is what the API turns into 409", async () => {
    const m = await db.query<{ id: string }>(
      "INSERT INTO mines (name) VALUES ('Ogies') RETURNING id",
    );
    await db.query("UPDATE mines SET location = 'A' WHERE id = $1 AND version = 1", [m.rows[0].id]);
    const second = await db.query(
      "UPDATE mines SET location = 'B' WHERE id = $1 AND version = 1 RETURNING id",
      [m.rows[0].id],
    );
    expect(second.rows).toHaveLength(0);
  });
});
