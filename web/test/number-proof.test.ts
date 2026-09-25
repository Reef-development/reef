import { describe, expect, it } from "vitest";
import { collectKnownNumbers, extractNumbers, verifyAnswer } from "../src/lib/reefie/number-proof";
import { buildFallbackAnswer } from "../src/lib/reefie/fallback-template";
import { isSiteComparisonRequest, SITE_COMPARISON_REFUSAL } from "../src/lib/reefie/site-guard";

const SAMPLE_TOOL_OUTPUT = {
  total_items: 42,
  inventory_value: 1284500.5,
  low_stock: [{ name: "Magnetite" }, { name: "V-belts" }, { name: "Grease" }],
  purchase_orders: [{ id: "po1" }, { id: "po2" }],
};

describe("extractNumbers", () => {
  it("pulls plain, currency and percentage numbers out of text", () => {
    const found = extractNumbers(
      "Stock is worth R1 284 500.50 across 42 items, 3 of them are at 45% of expected life.",
    );
    const values = found.map((n) => n.value);
    expect(values).toContain(1284500.5);
    expect(values).toContain(42);
    expect(values).toContain(3);
    expect(values).toContain(45);
  });

  it("does not flag a plain four-digit year as a claimed figure", () => {
    const found = extractNumbers("As of 2026, production is steady.");
    expect(found.map((n) => n.value)).not.toContain(2026);
  });
});

describe("collectKnownNumbers", () => {
  it("includes array lengths, not just field values", () => {
    const known = collectKnownNumbers([SAMPLE_TOOL_OUTPUT]);
    expect(known).toContain(3); // low_stock.length
    expect(known).toContain(2); // purchase_orders.length
    expect(known).toContain(42);
    expect(known).toContain(1284500.5);
  });
});

describe("verifyAnswer — the required deliberately-invented-number test", () => {
  it("passes an answer whose numbers all trace back to the fetched data", () => {
    const answer =
      "You have 42 stock items worth R1 284 500.50 in total, and 3 are at or below their reorder point.";
    const result = verifyAnswer(answer, [SAMPLE_TOOL_OUTPUT]);
    expect(result.ok).toBe(true);
  });

  it("catches a deliberately invented number that never appeared in the fetched data", () => {
    // 42 and 3 are real; 999 is planted and has no source in SAMPLE_TOOL_OUTPUT.
    const answer =
      "You have 42 stock items, 3 are low, and inventory has grown by 999 units since last month.";
    const result = verifyAnswer(answer, [SAMPLE_TOOL_OUTPUT]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.badNumbers.map((n) => n.value)).toContain(999);
      expect(result.badNumbers.map((n) => n.value)).not.toContain(42);
    }
  });

  it("catches a subtly wrong currency figure, not just wildly-off ones", () => {
    // Real value is 1284500.50; this is close enough to look plausible but is not what was fetched.
    const answer = "Total inventory value is R1 300 000.00.";
    const result = verifyAnswer(answer, [SAMPLE_TOOL_OUTPUT]);
    expect(result.ok).toBe(false);
  });

  it("does not false-positive on rounding-level currency formatting", () => {
    const answer = "Inventory value is roughly R1 284 500.50.";
    const result = verifyAnswer(answer, [SAMPLE_TOOL_OUTPUT]);
    expect(result.ok).toBe(true);
  });
});

describe("buildFallbackAnswer", () => {
  it("renders a plain summary from raw tool output with no invented text", () => {
    const text = buildFallbackAnswer([
      { toolName: "inventory_status", output: SAMPLE_TOOL_OUTPUT },
    ]);
    expect(text).toContain("thrown that draft away");
    expect(text).toContain("42");
    expect(text).toContain("R1 284 500.50");
  });
});

describe("isSiteComparisonRequest", () => {
  it("refuses a request to compare two named sites", () => {
    expect(
      isSiteComparisonRequest(
        "Can you compare the Witbank site and the Middelburg site's cost per ton?",
      ),
    ).toBe(true);
  });

  it("refuses a request to rank all sites", () => {
    expect(isSiteComparisonRequest("Rank all our mines by downtime this month.")).toBe(true);
  });

  it("does not refuse a single-site question", () => {
    expect(isSiteComparisonRequest("What's the cost per ton at the Witbank site this month?")).toBe(
      false,
    );
  });

  it("does not refuse comparing a site against its own target", () => {
    expect(isSiteComparisonRequest("How does this month's cost per ton compare to target?")).toBe(
      false,
    );
  });

  it("ships a clear refusal message", () => {
    expect(SITE_COMPARISON_REFUSAL.length).toBeGreaterThan(0);
  });
});
