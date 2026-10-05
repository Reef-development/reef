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
