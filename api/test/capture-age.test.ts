import { describe, expect, it } from "vitest";
import { daysBetween, lateCaptureProblem, reefToday } from "@reef/shared";
import { STOCK, testApp } from "./fakes.js";

const MINE = "00000000-0000-4000-8000-0000000000aa";
const EQUIPMENT = "00000000-0000-4000-8000-0000000000bb";

const daysAgo = (days: number) => {
  const d = new Date(`${reefToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

describe("T10: the rule itself", () => {
  it("accepts an entry exactly at the limit and refuses one a day older", () => {
    expect(lateCaptureProblem("2026-08-03", 60, "2026-10-02")).toBeNull();
    expect(lateCaptureProblem("2026-08-02", 60, "2026-10-02")).toMatch(/61 days ago/);
  });

  it("explains the refusal in words a worker can act on", () => {
    expect(lateCaptureProblem("2026-07-12", 60, "2026-10-02")).toBe(
      "This entry is dated 12 Jul 2026, which is 82 days ago. Entries older than 60 days can't be captured. " +
        "If it still needs recording, speak to your site manager.",
    );
  });

  it("counts days in South African time, so just after midnight is already the new day", () => {
    // 22:30 UTC on 1 October is 00:30 on 2 October in Mpumalanga.
    expect(reefToday(new Date("2026-10-01T22:30:00Z"))).toBe("2026-10-02");
    expect(daysBetween("2026-10-01", reefToday(new Date("2026-10-01T22:30:00Z")))).toBe(1);
  });
});

describe("T10: capture endpoints refuse very old entries", () => {
  it("refuses a production entry older than the limit, with the reason against the date field", async () => {
    const { call, production } = testApp();
    const res = await call("POST", "/api/v1/production-logs", {
      token: "worker-token",
      body: { mine_id: MINE, tons_produced: 300, date: daysAgo(61) },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(
      /61 days ago\. Entries older than 60 days can't be captured/,
    );
    expect(body.error.details).toEqual([expect.objectContaining({ path: "date" })]);
    expect(production.rows).toHaveLength(0);
  });

  it("accepts an entry exactly 60 days old, and one with no date (today)", async () => {
    const { call } = testApp();
    for (const body of [
      { mine_id: MINE, tons_produced: 300, date: daysAgo(60) },
      { mine_id: MINE, tons_produced: 300 },
    ]) {
      expect(
        (await call("POST", "/api/v1/production-logs", { token: "worker-token", body })).status,
      ).toBe(201);
    }
  });

  it("guards fuel slips and repairs too", async () => {
    const { call } = testApp();
    const fuel = await call("POST", "/api/v1/fuel-slips", {
      token: "worker-token",
      body: { vehicle_label: "LDV 3", litres: 40, cost_per_litre: 22, date: daysAgo(90) },
    });
    const repair = await call("POST", "/api/v1/maintenance-logs", {
      token: "worker-token",
      body: {
        equipment_id: EQUIPMENT,
        description: "Old repair",
        date: daysAgo(90),
        parts: [{ stock_item_id: STOCK.bearing.id, qty: 1 }],
      },
    });
    expect(fuel.status).toBe(400);
    expect(repair.status).toBe(400);
  });

  it("applies to managers and owners as well as workers", async () => {
    const { call } = testApp();
    for (const token of ["manager-token", "owner-token"]) {
      const res = await call("POST", "/api/v1/production-logs", {
        token,
        body: { mine_id: MINE, tons_produced: 1, date: daysAgo(100) },
      });
      expect(res.status).toBe(400);
    }
  });

  it("does not block a manager correcting an existing entry", async () => {
    const { call, production } = testApp();
    const old = await production.create({ mine_id: MINE, tons_produced: 100, date: daysAgo(120) });
    const res = await call("PATCH", `/api/v1/production-logs/${old.id}`, {
      token: "manager-token",
      body: { tons_produced: 110, version: 1, reason: "Weighbridge slip corrected" },
    });
    expect(res.status).toBe(200);
  });

  it("uses the owner's setting: raising it to 90 lets a 75-day-old entry through", async () => {
    const { call } = testApp();
    const raised = await call("PATCH", "/api/v1/settings/capture_max_age_days", {
      token: "owner-token",
      body: { value: 90 },
    });
    expect(raised.status).toBe(200);
    const res = await call("POST", "/api/v1/production-logs", {
      token: "worker-token",
      body: { mine_id: MINE, tons_produced: 300, date: daysAgo(75) },
    });
    expect(res.status).toBe(201);
  });
});

describe("T10: the limit is a setting", () => {
  it("defaults to 60 days and every role can read it", async () => {
    const res = await testApp().call("GET", "/api/v1/settings", { token: "worker-token" });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toContainEqual(
      expect.objectContaining({ key: "capture_max_age_days", value: 60 }),
    );
  });

  it("refuses a manager changing it", async () => {
    const { call, settingsStore } = testApp();
    const res = await call("PATCH", "/api/v1/settings/capture_max_age_days", {
      token: "manager-token",
      body: { value: 365 },
    });
    expect(res.status).toBe(403);
    expect(settingsStore[0].value).toBe(60);
  });

  it("refuses values that are not whole days from 1 to 365, and unknown settings", async () => {
    const { call } = testApp();
    for (const value of [0, 366, 12.5, "60"]) {
      const res = await call("PATCH", "/api/v1/settings/capture_max_age_days", {
        token: "owner-token",
        body: { value },
      });
      expect(res.status).toBe(400);
    }
    const unknown = await call("PATCH", "/api/v1/settings/free_beer", {
      token: "owner-token",
      body: { value: 1 },
    });
    expect(unknown.status).toBe(400);
  });
});
