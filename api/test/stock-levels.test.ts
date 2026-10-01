import { describe, expect, it } from "vitest";
import { testApp } from "./fakes.js";

/** Seed helper: create a stock level via the owner, so the plant is set explicitly. */
async function seedLevel(
  call: ReturnType<typeof testApp>["call"],
  input: { stock_item_id: string; plant: string; qty_on_hand: number; reorder_point?: number },
) {
  const res = await call("POST", "/api/v1/stock-levels", {
    token: "owner-token",
    body: input,
  });
  expect(res.status).toBe(201);
  return (await res.json()).data as { id: string; plant: string };
}

const magnetiteId = "11111111-1111-4111-8111-111111111111";

describe("T14: stock levels are scoped to the caller's plant", () => {
  it("lets a worker at plant A read levels at plant A", async () => {
    const { call, stockLevels } = testApp();
    await seedLevel(call, { stock_item_id: magnetiteId, plant: "A", qty_on_hand: 100 });
    await seedLevel(call, { stock_item_id: magnetiteId, plant: "B", qty_on_hand: 20 });

    const res = await call("GET", "/api/v1/stock-levels", { token: "worker-token" });
    expect(res.status).toBe(200);

    const body = await res.json();
    const plants = body.data.map((r: { plant: string }) => r.plant);
    expect(plants).toEqual(["A"]);
    // Both rows exist; the filter hid one.
    expect(stockLevels.rows).toHaveLength(2);
  });

  it("answers 404, not 403, for a stock level at another plant", async () => {
    const { call, stockLevels } = testApp();
    const b = await seedLevel(call, {
      stock_item_id: magnetiteId,
      plant: "B",
      qty_on_hand: 20,
    });

    const res = await call("GET", `/api/v1/stock-levels/${b.id}`, { token: "worker-token" });
    // A refusal would say "this exists but you cannot see it". A 404 says "no such level".
    expect(res.status).toBe(404);
    expect(stockLevels.rows).toHaveLength(1); // the row is still there
  });

  it("lets the owner see every plant's levels", async () => {
    const { call } = testApp();
    await seedLevel(call, { stock_item_id: magnetiteId, plant: "A", qty_on_hand: 100 });
    await seedLevel(call, { stock_item_id: magnetiteId, plant: "B", qty_on_hand: 20 });

    const res = await call("GET", "/api/v1/stock-levels", { token: "owner-token" });
    expect(res.status).toBe(200);

    const body = await res.json();
    const plants = body.data
      .map((r: { plant: string }) => r.plant)
      .sort();
    expect(plants).toEqual(["A", "B"]);
  });

  it("holds the same part's levels independently at each plant", async () => {
    const { call } = testApp();
    await seedLevel(call, { stock_item_id: magnetiteId, plant: "A", qty_on_hand: 100 });
    await seedLevel(call, { stock_item_id: magnetiteId, plant: "B", qty_on_hand: 20 });

    // Owner reads both, filters by plant, asserts each holds its own figure.
    const res = await call("GET", "/api/v1/stock-levels", { token: "owner-token" });
    const body = await res.json();
    const byPlant = Object.fromEntries(
      body.data.map((r: { plant: string; qty_on_hand: number }) => [r.plant, r.qty_on_hand]),
    );
    // Same stock_item_id, two different quantities. That is the whole point of the split.
    expect(byPlant).toEqual({ A: 100, B: 20 });
  });
});