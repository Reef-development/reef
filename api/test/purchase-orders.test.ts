import { describe, expect, it } from "vitest";
import { testApp } from "./fakes.js";

const supplierId = "22222222-2222-4222-8222-222222222222";

describe("T14: purchase orders are management documents", () => {
  it("refuses a worker listing purchase orders", async () => {
    const { call } = testApp();
    // A worker sees stock levels but not purchase orders. REEF confirmed in writing:
    // employees may not place purchase orders, and a purchase order is a management document.
    const res = await call("GET", "/api/v1/purchase-orders", { token: "worker-token" });
    expect(res.status).toBe(403);
  });

  it("refuses a worker creating a purchase order", async () => {
    const { call, purchaseOrders } = testApp();
    const res = await call("POST", "/api/v1/purchase-orders", {
      token: "worker-token",
      body: { plant: "A", supplier_id: supplierId, total_cost: 5000 },
    });
    expect(res.status).toBe(403);
    // Nothing was written.
    expect(purchaseOrders.rows).toHaveLength(0);
  });

  it("lets a manager create a purchase order for their own plant", async () => {
    const { call, purchaseOrders } = testApp();
    const res = await call("POST", "/api/v1/purchase-orders", {
      token: "manager-token",
      body: { plant: "A", supplier_id: supplierId, total_cost: 5000 },
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.data.plant).toBe("A");
    expect(body.data.status).toBe("draft");
    expect(purchaseOrders.rows).toHaveLength(1);
  });

  it("overrides the requested plant with the manager's own plant", async () => {
    const { call } = testApp();
    // Manager belongs to plant A. They try to raise an order for plant B. The repository
    // writes it against their own plant, not the one they asked for.
    const res = await call("POST", "/api/v1/purchase-orders", {
      token: "manager-token",
      body: { plant: "B", supplier_id: supplierId, total_cost: 3000 },
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.data.plant).toBe("A");
  });

  it("lets the owner see every plant's orders, and a manager only their own", async () => {
    const { call } = testApp();
    // Seed one PO per plant as the owner.
    await call("POST", "/api/v1/purchase-orders", {
      token: "owner-token",
      body: { plant: "A", supplier_id: supplierId, total_cost: 1000 },
    });
    await call("POST", "/api/v1/purchase-orders", {
      token: "owner-token",
      body: { plant: "B", supplier_id: supplierId, total_cost: 2000 },
    });

    // Owner sees both.
    const ownerRes = await call("GET", "/api/v1/purchase-orders", { token: "owner-token" });
    expect(ownerRes.status).toBe(200);
    const ownerPlants = (await ownerRes.json()).data.map(
      (p: { plant: string }) => p.plant,
    ).sort();
    expect(ownerPlants).toEqual(["A", "B"]);

    // Manager at plant A sees only A.
    const mgrRes = await call("GET", "/api/v1/purchase-orders", { token: "manager-token" });
    expect(mgrRes.status).toBe(200);
    const mgrPlants = (await mgrRes.json()).data.map(
      (p: { plant: string }) => p.plant,
    );
    expect(mgrPlants).toEqual(["A"]);
  });

  it("answers 404, not 403, for a purchase order at another plant", async () => {
    const { call } = testApp();
    const created = await call("POST", "/api/v1/purchase-orders", {
      token: "owner-token",
      body: { plant: "B", supplier_id: supplierId, total_cost: 2000 },
    });
    const id = (await created.json()).data.id as string;

    // A manager at plant A asks for a plant-B order by id. They can see purchase orders,
    // so this is not a permission refusal — it is "no such record".
    const res = await call("GET", `/api/v1/purchase-orders/${id}`, { token: "manager-token" });
    expect(res.status).toBe(404);
  });
});