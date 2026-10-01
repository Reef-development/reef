import { describe, expect, it } from "vitest";
import { testApp } from "./fakes.js";

const magnetiteAtA = { name: "Magnetite", plant: "A" };
const vBeltsAtB = { name: "V-belts", plant: "B" };

describe("T14: stock is scoped to the caller's plant", () => {
  it("lets a worker at plant A read stock at plant A", async () => {
    const { call, stock } = testApp();
    // Seed one item at each plant, as the owner, so the plant field is set explicitly.
    await call("POST", "/api/v1/stock", { token: "owner-token", body: magnetiteAtA });
    await call("POST", "/api/v1/stock", { token: "owner-token", body: vBeltsAtB });

    const res = await call("GET", "/api/v1/stock", { token: "worker-token" });
    expect(res.status).toBe(200);

    const body = await res.json();
    const names = body.data.map((s: { name: string }) => s.name);
    expect(names).toEqual(["Magnetite"]);
    expect(stock.rows).toHaveLength(2); // the DB still has both; the filter hid one
  });

  it("answers 404, not 403, for a stock item at another plant", async () => {
    const { call, stock } = testApp();
    const created = await call("POST", "/api/v1/stock", {
      token: "owner-token",
      body: vBeltsAtB,
    });
    const id = (await created.json()).data.id as string;

    const res = await call("GET", `/api/v1/stock/${id}`, { token: "worker-token" });
    // A refusal would say "this exists but you cannot see it". A 404 says "no such item".
    expect(res.status).toBe(404);
    expect(stock.rows).toHaveLength(1); // the row is still there
  });

  it("lets the owner see every plant", async () => {
    const { call } = testApp();
    await call("POST", "/api/v1/stock", { token: "owner-token", body: magnetiteAtA });
    await call("POST", "/api/v1/stock", { token: "owner-token", body: vBeltsAtB });

    const res = await call("GET", "/api/v1/stock", { token: "owner-token" });
    expect(res.status).toBe(200);

    const body = await res.json();
    const names = body.data.map((s: { name: string }) => s.name).sort();
    expect(names).toEqual(["Magnetite", "V-belts"]);
  });

  it("does not let a worker create stock at a plant other than their own", async () => {
    const { call } = testApp();
    // Worker token belongs to plant A. They try to create an item at plant B.
    const res = await call("POST", "/api/v1/stock", {
      token: "worker-token",
      body: vBeltsAtB,
    });
    // Worker lacks stock:write, so this is refused at the permission layer.
    expect(res.status).toBe(403);
  });

  it("refuses a non-owner with no plant from creating stock", async () => {
    const { call } = testApp();
    // A manager whose profile has no plant cannot create — there is no plant to attribute
    // the row to. Falling back to the submitted plant would let them write into any plant
    // by asking.
    const res = await call("POST", "/api/v1/stock", {
      token: "no-plant-token",
      body: { name: "Ghost item", plant: "B" },
    });
    expect(res.status).toBe(403);
  });
});
