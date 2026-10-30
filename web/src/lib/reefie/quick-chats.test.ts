import { describe, expect, it } from "vitest";
import { CATEGORIES, groupByCategory, pickTopThree, PRESETS, type QuickChat } from "./quick-chats";

describe("pickTopThree", () => {
  it("starts with the defaults when nothing has been used", () => {
    expect(pickTopThree(PRESETS, []).map((q) => q.id)).toEqual([
      "stock-reorder",
      "equip-eol",
      "report-month",
    ]);
  });

  it("puts the most recently used first and tops up with defaults, without repeats", () => {
    const ids = pickTopThree(PRESETS, ["cost-total", "equip-eol"]).map((q) => q.id);
    expect(ids).toEqual(["cost-total", "equip-eol", "stock-reorder"]);
  });

  it("ignores recent ids that no longer exist", () => {
    const ids = pickTopThree(PRESETS, ["c-deleted"]).map((q) => q.id);
    expect(ids).toHaveLength(3);
    expect(ids).not.toContain("c-deleted");
  });

  it("can surface a custom quick chat", () => {
    const mine: QuickChat = {
      id: "c-1",
      category: "Costs",
      text: "Tyre spend this month?",
      custom: true,
    };
    expect(pickTopThree([...PRESETS, mine], ["c-1"])[0].id).toBe("c-1");
  });
});

describe("groupByCategory", () => {
  it("groups in category order and drops empty groups", () => {
    const groups = groupByCategory(PRESETS, "");
    expect(groups.map((g) => g.category)).toEqual([...CATEGORIES]);
  });

  it("searches the text and the category name, ignoring case", () => {
    expect(groupByCategory(PRESETS, "FUEL").flatMap((g) => g.items.map((i) => i.id))).toEqual([
      "cost-fuel",
    ]);
    expect(groupByCategory(PRESETS, "downtime").every((g) => g.category === "Downtime")).toBe(true);
    expect(groupByCategory(PRESETS, "zzzz")).toEqual([]);
  });
});
