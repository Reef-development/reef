import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, type Db } from "./harness.js";

// The purchase order rules against a real Postgres: lines only on a draft, the total from the
// lines, status one way, and a delivery received once.

let db: Db;
let owner: string;
let kriel: string; // a manager at Kriel
let ogies: string; // a manager at Ogies

beforeAll(async () => {
  db = await migratedDb();
  owner = await db.user("owner");
  kriel = await db.user("manager");
  ogies = await db.user("manager");
  // Plants are a list (#57), and only the service role may give someone a plant (T14).
  await db.query("INSERT INTO plants (name) VALUES ('Kriel'), ('Ogies') ON CONFLICT DO NOTHING");
  await db.transaction(async (tx) => {
    await tx.query("SELECT set_config('request.jwt.claim.role', 'service_role', true)");
    await tx.query("UPDATE profiles SET plant = 'Kriel' WHERE id = $1", [kriel]);
    await tx.query("UPDATE profiles SET plant = 'Ogies' WHERE id = $1", [ogies]);
  });
}, 60_000);

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0];

async function draftWithLine(plant = "Kriel", onHand = 2) {
  const item = await one<{ id: string }>(
    "INSERT INTO stock_items (name, plant, qty_on_hand, unit_cost) VALUES ('Idler', $1, $2, 100) RETURNING id",
    [plant, onHand],
  );
  const po = await one<{ id: string }>(
    "INSERT INTO purchase_orders (plant) VALUES ($1) RETURNING id",
    [plant],
  );
  await db.query(
    "INSERT INTO po_lines (po_id, stock_item_id, qty, unit_cost) VALUES ($1, $2, 5, 100)",
    [po.id, item.id],
  );
  return { po: po.id, item: item.id };
}

const transition = (userId: string, po: string, to: string, reason: string | null = null) =>
  db.as(userId, (tx) =>
    tx.query<{ status: string }>("SELECT * FROM po_transition($1, $2, $3)", [po, to, reason]),
  );
const status = async (po: string) =>
  (await one<{ status: string }>("SELECT status FROM purchase_orders WHERE id = $1", [po])).status;
const onHand = async (item: string) =>
  Number((await one<{ q: string }>("SELECT (stock_level_of($1)).qty_on_hand q", [item])).q);

describe("T22 purchasing: lines and the total", () => {
  it("keeps the total equal to the lines, and ignores a total typed in", async () => {
    const { po } = await draftWithLine();
    expect(
      Number(
        (await one<{ t: string }>("SELECT total_cost t FROM purchase_orders WHERE id = $1", [po]))
          .t,
      ),
    ).toBe(500);
    await db.query("UPDATE purchase_orders SET total_cost = 1 WHERE id = $1", [po]);
    expect(
      Number(
        (await one<{ t: string }>("SELECT total_cost t FROM purchase_orders WHERE id = $1", [po]))
          .t,
      ),
    ).toBe(500);
  });

  it("refuses a line once the order is approved", async () => {
    const { po, item } = await draftWithLine();
    await transition(kriel, po, "approved");
    await expect(
      db.query(
        "INSERT INTO po_lines (po_id, stock_item_id, qty, unit_cost) VALUES ($1, $2, 1, 100)",
        [po, item],
      ),
    ).rejects.toThrow(/only be changed while the order is a draft/);
  });

  it("refuses a line for stock at another plant", async () => {
    const { po } = await draftWithLine("Kriel");
    const other = await one<{ id: string }>(
      "INSERT INTO stock_items (name, plant) VALUES ('Chain', 'Ogies') RETURNING id",
    );
    await expect(
      db.query(
        "INSERT INTO po_lines (po_id, stock_item_id, qty, unit_cost) VALUES ($1, $2, 1, 10)",
        [po, other.id],
      ),
    ).rejects.toThrow(/not at this order's plant/);
  });

  it("does not let a manager see or add lines on another plant's order", async () => {
    const { po, item } = await draftWithLine("Kriel");
    const seen = await db.as(ogies, (tx) =>
      tx.query("SELECT * FROM po_lines WHERE po_id = $1", [po]),
    );
    expect(seen.rows).toHaveLength(0);
    await expect(
      db.as(ogies, (tx) =>
        tx.query(
          "INSERT INTO po_lines (po_id, stock_item_id, qty, unit_cost) VALUES ($1, $2, 1, 1)",
          [po, item],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("T22 purchasing: status moves one way", () => {
  it("goes draft, approved, ordered, received, and adds the stock once", async () => {
    const { po, item } = await draftWithLine("Kriel", 2);
    await transition(kriel, po, "approved");
    await transition(kriel, po, "ordered");
    await transition(kriel, po, "received");
    expect(await status(po)).toBe("received");
    expect(await onHand(item)).toBe(7);
  });

  it("refuses receiving the same delivery twice, so stock is not doubled", async () => {
    const { po, item } = await draftWithLine("Kriel", 0);
    await transition(kriel, po, "approved");
    await transition(kriel, po, "received");
    await expect(transition(kriel, po, "received")).rejects.toThrow(/already received/);
    // Nor by going back to draft and receiving again.
    await expect(
      db.query("UPDATE purchase_orders SET status = 'draft' WHERE id = $1", [po]),
    ).rejects.toThrow(/cannot be marked draft/);
    expect(await onHand(item)).toBe(5);
  });

  it("refuses skipping approval", async () => {
    const { po, item } = await draftWithLine("Kriel", 0);
    await expect(transition(kriel, po, "received")).rejects.toThrow(
      /draft cannot be marked received/,
    );
    expect(await onHand(item)).toBe(0);
  });

  it("refuses approving an order with no lines", async () => {
    const po = await one<{ id: string }>(
      "INSERT INTO purchase_orders (plant) VALUES ('Kriel') RETURNING id",
    );
    await expect(transition(kriel, po.id, "approved")).rejects.toThrow(
      /no lines cannot be approved/,
    );
  });

  it("cancels only with a reason, and a cancelled order is final", async () => {
    const { po } = await draftWithLine();
    await expect(transition(kriel, po, "cancelled")).rejects.toThrow(/reason is required/);
    await transition(kriel, po, "cancelled", "Supplier went out of business");
    await expect(transition(kriel, po, "approved")).rejects.toThrow(
      /cancelled cannot be marked approved/,
    );
  });

  it("returns nothing for another plant's order, so the API can answer not found", async () => {
    const { po } = await draftWithLine("Kriel");
    const { rows } = await transition(ogies, po, "approved");
    expect(rows).toHaveLength(0);
    expect(await status(po)).toBe("draft");
  });

  it("lets the owner move any plant's order", async () => {
    const { po } = await draftWithLine("Ogies");
    const { rows } = await transition(owner, po, "approved");
    expect(rows[0].status).toBe("approved");
  });
});
