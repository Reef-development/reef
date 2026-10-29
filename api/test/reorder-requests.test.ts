import { describe, expect, it } from "vitest";
import { testApp } from "./fakes.js";

const requestId = "11111111-1111-4111-8111-111111111111";

describe("T14B: reorder requests", () => {
  it("refuses a worker listing reorder requests", async () => {
    const { call } = testApp();

    const res = await call("GET", "/api/v1/reorder-requests", {
      token: "worker-token",
    });

    expect(res.status).toBe(403);
  });

  it("refuses a worker converting a reorder request into a purchase order", async () => {
    const { call } = testApp();

    const res = await call("POST", `/api/v1/reorder-requests/${requestId}/convert`, {
      token: "worker-token",
    });

    expect(res.status).toBe(403);
  });

  it("registers the reorder request list and conversion routes", () => {
    const routes = testApp().registry.routes.map((route) => `${route.method} ${route.path}`);

    expect(routes).toContain("GET /api/v1/reorder-requests");
    expect(routes).toContain("POST /api/v1/reorder-requests/:id/convert");
  });
});

describe("T14B: reorder requests for managers", () => {
  const open = {
    id: requestId,
    status: "open",
    plant: "Kriel",
    stock_item_id: "22222222-2222-4222-8222-222222222222",
  };

  it("lists the open requests and leaves out converted ones", async () => {
    const app = testApp();
    app.reorderRequests.rows = [
      { ...open },
      { ...open, id: "33333333-3333-4333-8333-333333333333", status: "converted" },
    ];
    const res = await app.call("GET", "/api/v1/reorder-requests", { token: "manager-token" });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.map((r: { id: string }) => r.id)).toEqual([requestId]);
  });

  it("turns an open request into a draft purchase order, once", async () => {
    const app = testApp();
    app.reorderRequests.rows = [{ ...open }];
    const res = await app.call("POST", `/api/v1/reorder-requests/${requestId}/convert`, {
      token: "manager-token",
    });
    expect(res.status).toBe(201);
    expect((await res.json()).data.status).toBe("draft");

    const again = await app.call("POST", `/api/v1/reorder-requests/${requestId}/convert`, {
      token: "manager-token",
    });
    expect(again.status).toBe(404);
  });

  it("refuses an id that is not an id", async () => {
    const app = testApp();
    const res = await app.call("POST", "/api/v1/reorder-requests/nope/convert", {
      token: "manager-token",
    });
    expect(res.status).toBe(400);
  });
});
