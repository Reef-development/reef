import { beforeEach, describe, expect, it } from "vitest";
import { testApp } from "./fakes.js";

/**
 * The money figures, through the HTTP surface, because that is where the permission rule and
 * the arithmetic meet. The cases that matter are the ones where the honest answer is not a
 * number: a site that produced nothing, and a manager asking for the ranking.
 */
const ALPHA = "00000000-0000-4000-8000-0000000000a1";
const BETA = "00000000-0000-4000-8000-0000000000b1";

function seed(app: ReturnType<typeof testApp>) {
  app.analytics.sites = [
    { id: ALPHA, name: "Mokopane Plant A" },
    { id: BETA, name: "Mokopane Plant B" },
  ];
  app.analytics.production = [
    { mine_id: ALPHA, date: "2026-08-10", tons: 600, magnetite: 1000, overtime: 500 },
    { mine_id: ALPHA, date: "2026-08-11", tons: 400, magnetite: 800, overtime: 200 },
    // Outside the period on purpose: a boundary fault would pull this in.
    { mine_id: ALPHA, date: "2026-09-01", tons: 9999, magnetite: 0, overtime: 0 },
  ];
  app.analytics.fixed = [{ mine_id: ALPHA, month: "2026-08", amount: 31000 }];
  app.analytics.maintenance = [{ mine_id: ALPHA, date: "2026-08-12", cost: 2000 }];
  app.analytics.fuel = [{ mine_id: ALPHA, date: "2026-08-12", cost: 1500 }];
  app.analytics.downtime = [
    { mine_id: ALPHA, date: "2026-08-13", reason: "breakdown", hours: 6 },
    { mine_id: ALPHA, date: "2026-08-14", reason: "no_stock", hours: 2 },
  ];
}

describe("cost per ton", () => {
  let app: ReturnType<typeof testApp>;
  beforeEach(() => {
    app = testApp();
    seed(app);
  });

  it("adds fixed and variable costs and divides by the tons in the period", async () => {
    const res = await app.call(
      "GET",
      `/api/v1/analytics/cost-per-ton?from=2026-08-01&to=2026-08-31&mine_id=${ALPHA}`,
      { token: "manager-token" },
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.tons_produced).toBe(1000);
    expect(data.fixed_costs).toBe(31000);
    expect(data.total_cost).toBe(31000 + 1800 + 700 + 2000 + 1500);
    expect(data.cost_per_ton).toBe(37);
    expect(data.no_production).toBe(false);
  });

  it("apportions a fixed monthly cost across a part month rather than charging all of it", async () => {
    // Sixteen of August's thirty one days.
    const res = await app.call(
      "GET",
      `/api/v1/analytics/cost-per-ton?from=2026-08-01&to=2026-08-16&mine_id=${ALPHA}`,
      { token: "manager-token" },
    );
    const { data } = await res.json();
    expect(data.fixed_costs).toBe(16000);
  });

  it("returns null rather than zero when nothing was produced", async () => {
    const res = await app.call(
      "GET",
      `/api/v1/analytics/cost-per-ton?from=2026-08-01&to=2026-08-31&mine_id=${BETA}`,
      { token: "manager-token" },
    );
    const { data } = await res.json();
    expect(data.cost_per_ton).toBeNull();
    expect(data.no_production).toBe(true);
  });

  it("refuses a worker, who captures the numbers but does not see what they add up to", async () => {
    const res = await app.call(
      "GET",
      "/api/v1/analytics/cost-per-ton?from=2026-08-01&to=2026-08-31",
      { token: "worker-token" },
    );
    expect(res.status).toBe(403);
  });

  it("refuses a period that runs backwards", async () => {
    const res = await app.call(
      "GET",
      "/api/v1/analytics/cost-per-ton?from=2026-08-31&to=2026-08-01",
      { token: "manager-token" },
    );
    expect(res.status).toBe(400);
  });
});

describe("the comparison", () => {
  let app: ReturnType<typeof testApp>;
  beforeEach(() => {
    app = testApp();
    seed(app);
  });

  it("is the owner's alone", async () => {
    const asManager = await app.call(
      "GET",
      "/api/v1/analytics/comparison?from=2026-08-01&to=2026-08-31",
      { token: "manager-token" },
    );
    expect(asManager.status).toBe(403);

    const asOwner = await app.call(
      "GET",
      "/api/v1/analytics/comparison?from=2026-08-01&to=2026-08-31",
      { token: "owner-token" },
    );
    expect(asOwner.status).toBe(200);
  });

  it("puts a site that produced nothing last, not first", async () => {
    const res = await app.call(
      "GET",
      "/api/v1/analytics/comparison?from=2026-08-01&to=2026-08-31",
      { token: "owner-token" },
    );
    const { data } = await res.json();
    expect(data[0].mine_name).toBe("Mokopane Plant A");
    expect(data[1].cost_per_ton).toBeNull();
  });
});

describe("the monthly report", () => {
  it("narrates only figures that are in the same response", async () => {
    const app = testApp();
    seed(app);
    const res = await app.call("GET", `/api/v1/reports/monthly?month=2026-08&mine_id=${ALPHA}`, {
      token: "manager-token",
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.cost.cost_per_ton).toBe(37);
    expect(data.narrative.join(" ")).toContain("37.00");
    expect(data.downtime[0]).toEqual({ reason: "breakdown", hours: 6 });
  });

  it("refuses a month that is not YYYY-MM", async () => {
    const app = testApp();
    seed(app);
    const res = await app.call("GET", `/api/v1/reports/monthly?month=August&mine_id=${ALPHA}`, {
      token: "manager-token",
    });
    expect(res.status).toBe(400);
  });
});
