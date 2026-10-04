import { describe, expect, it } from "vitest";
import { testApp } from "./fakes.js";

// T22 (purchasing): order lines and the steps an order moves through. The plant in these fakes
// is "A" for the manager and worker; the owner sees every plant.

async function setup() {
  const t = testApp();
  const part = await t.stock.create(
    { name: "Idler", plant: "A", unit_cost: 120 },
    { role: "owner", plant: null },
  );
  const order = await t.purchaseOrders.create({ plant: "A" }, { role: "owner", plant: null });
  return { ...t, part: part.id, order: order.id };
}

const line = (part: string, qty = 5) => ({ stock_item_id: part, qty });

describe("T22 purchasing: order lines", () => {
  it("adds a line priced from the catalogue, and the order's total follows", async () => {
    const { call, part, order, purchaseOrders } = await setup();
    const res = await call("POST", `/api/v1/purchase-orders/${order}/lines`, {
      token: "manager-token",
      body: line(part, 5),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ qty: 5, unit_cost: 120 });
    expect(purchaseOrders.rows[0].total_cost).toBe(600);

    const list = await call("GET", `/api/v1/purchase-orders/${order}/lines`, {
      token: "manager-token",
    });
    expect((await list.json()).data).toHaveLength(1);
  });

  it("refuses a line once the order is approved", async () => {
    const { call, part, order } = await setup();
    await call("POST", `/api/v1/purchase-orders/${order}/lines`, {
      token: "manager-token",
      body: line(part),
    });
    await call("POST", `/api/v1/purchase-orders/${order}/approve`, {
      token: "manager-token",
      body: {},
    });
    const res = await call("POST", `/api/v1/purchase-orders/${order}/lines`, {
      token: "manager-token",
      body: line(part),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(/only be changed while the order is a draft/);
  });

  it("refuses a quantity of zero, and a worker", async () => {
    const { call, part, order } = await setup();
    const zero = await call("POST", `/api/v1/purchase-orders/${order}/lines`, {
      token: "manager-token",
      body: line(part, 0),
    });
    expect(zero.status).toBe(400);
    const worker = await call("POST", `/api/v1/purchase-orders/${order}/lines`, {
      token: "worker-token",
      body: line(part),
    });
    expect(worker.status).toBe(403);
  });
});

describe("T22 purchasing: an order moves one way", () => {
  it("approves, orders and receives", async () => {
    const { call, part, order } = await setup();
    await call("POST", `/api/v1/purchase-orders/${order}/lines`, {
      token: "manager-token",
      body: line(part),
    });
    for (const step of ["approve", "order", "receive"]) {
      const res = await call("POST", `/api/v1/purchase-orders/${order}/${step}`, {
        token: "manager-token",
        body: {},
      });
      expect(res.status).toBe(200);
    }
  });

  it("will not receive the same delivery twice", async () => {
    const { call, part, order, purchaseActions } = await setup();
    await call("POST", `/api/v1/purchase-orders/${order}/lines`, {
      token: "manager-token",
      body: line(part),
    });
    await call("POST", `/api/v1/purchase-orders/${order}/approve`, {
      token: "manager-token",
      body: {},
    });
    const first = await call("POST", `/api/v1/purchase-orders/${order}/receive`, {
      token: "manager-token",
      body: {},
    });
    const second = await call("POST", `/api/v1/purchase-orders/${order}/receive`, {
      token: "manager-token",
      body: {},
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect((await second.json()).error.message).toMatch(/already received/);
    expect(purchaseActions.received.get(order)).toBe(1);
  });

  it("refuses approving an empty order, and skipping approval", async () => {
    const { call, part, order } = await setup();
    const empty = await call("POST", `/api/v1/purchase-orders/${order}/approve`, {
      token: "manager-token",
      body: {},
    });
    expect(empty.status).toBe(409);
    await call("POST", `/api/v1/purchase-orders/${order}/lines`, {
      token: "manager-token",
      body: line(part),
    });
    const skip = await call("POST", `/api/v1/purchase-orders/${order}/receive`, {
      token: "manager-token",
      body: {},
    });
    expect(skip.status).toBe(409);
  });

  it("cancels only with a reason", async () => {
    const { call, order } = await setup();
    const none = await call("POST", `/api/v1/purchase-orders/${order}/cancel`, {
      token: "manager-token",
      body: {},
    });
    expect(none.status).toBe(400);
    const ok = await call("POST", `/api/v1/purchase-orders/${order}/cancel`, {
      token: "manager-token",
      body: { reason: "Supplier went out of business" },
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.status).toBe("cancelled");
  });

  it("answers not found for another plant's order", async () => {
    const t = testApp();
    const other = await t.purchaseOrders.create({ plant: "B" }, { role: "owner", plant: null });
    const res = await t.call("POST", `/api/v1/purchase-orders/${other.id}/cancel`, {
      token: "manager-token",
      body: { reason: "Not ours" },
    });
    expect(res.status).toBe(404);
    const lines = await t.call("GET", `/api/v1/purchase-orders/${other.id}/lines`, {
      token: "manager-token",
    });
    expect(lines.status).toBe(404);
  });

  it("refuses a worker every step", async () => {
    const { call, order } = await setup();
    for (const step of ["approve", "order", "receive", "cancel"]) {
      const res = await call("POST", `/api/v1/purchase-orders/${order}/${step}`, {
        token: "worker-token",
        body: { reason: "x" },
      });
      expect(res.status).toBe(403);
    }
  });
});
