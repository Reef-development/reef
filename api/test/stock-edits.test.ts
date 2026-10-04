import { describe, expect, it } from "vitest";
import { testApp } from "./fakes.js";

// T14A: editing stock through the API. Since T6 every edit needs a reason; T14's stock routes
// accepted it and then passed it on to the table as if it were a column. These prove the reason
// is required, goes to the repository, and is never stored on the record.

const PART = "11111111-1111-4111-8111-111111111111";

async function seeded() {
  const t = testApp();
  const item = await (
    await t.call("POST", "/api/v1/stock", {
      token: "owner-token",
      body: { name: "Bearing 6205", plant: "A", unit_cost: 150 },
    })
  ).json();
  const level = await (
    await t.call("POST", "/api/v1/stock-levels", {
      token: "owner-token",
      body: { stock_item_id: PART, plant: "A", qty_on_hand: 10, reorder_point: 4 },
    })
  ).json();
  return { ...t, itemId: item.data.id as string, levelId: level.data.id as string };
}

describe("T14A: editing stock needs a reason, and the reason is not stored on the record", () => {
  it("changes a stock item's details with a reason", async () => {
    const { call, itemId, stock } = await seeded();
    const res = await call("PATCH", `/api/v1/stock/${itemId}`, {
      token: "manager-token",
      body: { unit_cost: 165, version: 1, reason: "Supplier put the price up" },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ unit_cost: 165, version: 2 });
    expect(stock.rows[0]).not.toHaveProperty("reason");
  });

  it("changes a plant's quantity and reorder point with a reason", async () => {
    const { call, levelId, stockLevels } = await seeded();
    const res = await call("PATCH", `/api/v1/stock-levels/${levelId}`, {
      token: "manager-token",
      body: { qty_on_hand: 8, reorder_point: 5, version: 1, reason: "Recount after the stocktake" },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ qty_on_hand: 8, reorder_point: 5 });
    expect(stockLevels.rows[0]).not.toHaveProperty("reason");
  });

  it("refuses an edit without a reason", async () => {
    const { call, itemId, levelId } = await seeded();
    for (const [path, body] of [
      [`/api/v1/stock/${itemId}`, { unit_cost: 1, version: 1 }],
      [`/api/v1/stock-levels/${levelId}`, { qty_on_hand: 1, version: 1 }],
      [`/api/v1/stock/${itemId}`, { unit_cost: 1, version: 1, reason: "   " }],
    ] as const) {
      const res = await call("PATCH", path, { token: "manager-token", body });
      expect(res.status).toBe(400);
    }
  });
});
