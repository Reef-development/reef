import { beforeEach, describe, expect, it } from "vitest";
import { answer, classify } from "../src/services/assistant.js";
import { unverifiedNumbers } from "../src/services/number-check.js";
import { MemoryAnalytics, testApp } from "./fakes.js";


const ALPHA = "00000000-0000-4000-8000-0000000000a1";
const BETA = "00000000-0000-4000-8000-0000000000b1";
const PERIOD = { from: "2026-08-01", to: "2026-08-31" };

function figures() {
  const a = new MemoryAnalytics();
  a.sites = [
    { id: ALPHA, name: "Mokopane Plant A" },
    { id: BETA, name: "Mokopane Plant B" },
  ];
  a.production = [
    { mine_id: ALPHA, date: "2026-08-10", tons: 600, magnetite: 1000, overtime: 500 },
    { mine_id: ALPHA, date: "2026-08-11", tons: 400, magnetite: 800, overtime: 200 },
  ];
  a.fixed = [{ mine_id: ALPHA, month: "2026-08", amount: 31000 }];
  a.maintenance = [{ mine_id: ALPHA, date: "2026-08-12", cost: 2000 }];
  a.fuel = [{ mine_id: ALPHA, date: "2026-08-12", cost: 1500 }];
  a.downtime = [{ mine_id: ALPHA, date: "2026-08-13", reason: "breakdown", hours: 6 }];
  return a;
}

describe("classify", () => {
  it("reads the question rather than guessing", () => {
    expect(classify("what did it cost a ton last month")).toBe("cost_per_ton");
    expect(classify("which site is cheapest")).toBe("comparison");
    expect(classify("how many tons did we produce")).toBe("production");
    expect(classify("how much downtime did we have")).toBe("downtime");
    expect(classify("who is on shift tomorrow")).toBe("unsupported");
  });

  it("is deterministic, because an authorisation branch follows from it", () => {
    const q = "compare cost per ton across the sites";
    expect(classify(q)).toBe(classify(q));
  });
});

describe("the assistant", () => {
  let analytics: MemoryAnalytics;
  beforeEach(() => {
    analytics = figures();
  });

  it("answers cost per ton from the records, and lists what it used", async () => {
    const result = await answer(
      analytics,
      { question: "what was the cost per ton", mine_id: ALPHA, ...PERIOD },
      true,
    );
    expect(result.intent).toBe("cost_per_ton");
    expect(result.discarded).toBe(false);
    expect(result.answer).toContain("R 37.00");
    expect(result.figures.find((f) => f.label === "Cost per ton")?.value).toBe("R 37.00");
  });

  it("says so plainly when there is no production, rather than reporting a cost of zero", async () => {
    const result = await answer(
      analytics,
      { question: "cost per ton please", mine_id: BETA, ...PERIOD },
      true,
    );
    expect(result.answer).toContain("no production");
    expect(result.figures.find((f) => f.label === "Cost per ton")?.value).toBe("no production");
  });

  it("refuses a manager asking to compare sites, as the comparison endpoint does", async () => {
    await expect(
      answer(analytics, { question: "which site is cheapest", ...PERIOD }, false),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("answers the comparison for the owner", async () => {
    const result = await answer(analytics, { question: "which site is cheapest", ...PERIOD }, true);
    expect(result.answer).toContain("Mokopane Plant A");
    expect(result.answer).toContain("cheapest");
  });

  it("every number it writes is in the figures it listed", async () => {
    for (const question of [
      "what was the cost per ton",
      "how many tons did we produce",
      "how much downtime",
      "which site is cheapest",
    ]) {
      const result = await answer(analytics, { question, mine_id: ALPHA, ...PERIOD }, true);
      const allowed = [
        ...result.figures.map((f) => `${f.label} ${f.value}`),
        result.scope,
        "Mokopane Plant A",
        "Mokopane Plant B",
      ];
      expect(unverifiedNumbers(result.answer, allowed)).toEqual([]);
    }
  });

  it("throws the sentence away when a figure in it is not in the records", async () => {
    // A site name carrying a number that no figure contains stands in for the invented
    // figure a language model would produce if one were put behind this later.
    analytics.sites = [{ id: ALPHA, name: "Plant A" }];
    const result = await answer(
      analytics,
      { question: "how much downtime", mine_id: ALPHA, ...PERIOD },
      true,
    );
    const tampered = `${result.answer} That is 88 hours more than July.`;
    const allowed = [...result.figures.map((f) => `${f.label} ${f.value}`), result.scope];
    expect(unverifiedNumbers(tampered, allowed)).toEqual(["88"]);
  });
});

describe("the assistant endpoint", () => {
  it("is refused to a worker and answered for a manager", async () => {
    const app = testApp();
    app.analytics.sites = [{ id: ALPHA, name: "Mokopane Plant A" }];

    const asWorker = await app.call("POST", "/api/v1/assistant/ask", {
      token: "worker-token",
      body: { question: "what did it cost a ton" },
    });
    expect(asWorker.status).toBe(403);

    const asManager = await app.call("POST", "/api/v1/assistant/ask", {
      token: "manager-token",
      body: { question: "what did it cost a ton" },
    });
    expect(asManager.status).toBe(200);
    const { data } = await asManager.json();
    expect(data.intent).toBe("cost_per_ton");
    expect(data.discarded).toBe(false);
  });

  it("refuses a question that is not a question", async () => {
    const app = testApp();
    const res = await app.call("POST", "/api/v1/assistant/ask", {
      token: "manager-token",
      body: { question: "" },
    });
    expect(res.status).toBe(400);
  });
});
