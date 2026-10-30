import { describe, expect, it } from "vitest";
import { groupThreads, relativeTime, threadTitle, type Thread } from "./threads";

const HOUR = 3_600_000;
const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * HOUR).toISOString();
const t = (id: string, title: string | null, hoursAgo: number): Thread => ({
  id,
  title,
  updated_at: at(hoursAgo),
});

describe("threadTitle", () => {
  it("falls back to the default title when blank", () => {
    expect(threadTitle({ title: null })).toBe("New conversation");
    expect(threadTitle({ title: "   " })).toBe("New conversation");
    expect(threadTitle({ title: "Stock check" })).toBe("Stock check");
  });
});

describe("groupThreads", () => {
  const threads = [
    t("a", "Stock below reorder", 0.1),
    t("b", "Report", 100),
    t("c", "Costs per ton", 24 * 30),
  ];

  it("puts pinned chats first and out of their date group", () => {
    const groups = groupThreads(threads, ["c"], "");
    expect(groups[0].label).toBe("Pinned");
    expect(groups[0].items.map((x) => x.id)).toEqual(["c"]);
    expect(
      groups
        .flatMap((g) => g.items)
        .map((x) => x.id)
        .sort(),
    ).toEqual(["a", "b", "c"]);
  });

  it("filters by search text, ignoring case", () => {
    const groups = groupThreads(threads, [], "COSTS");
    expect(groups.flatMap((g) => g.items.map((x) => x.id))).toEqual(["c"]);
  });

  it("drops empty groups and returns nothing when nothing matches", () => {
    expect(groupThreads(threads, [], "zzz")).toEqual([]);
  });
});

describe("relativeTime", () => {
  it("reads naturally", () => {
    expect(relativeTime(at(0))).toBe("Just now");
    expect(relativeTime(at(3))).toBe("3h ago");
    expect(relativeTime(at(48))).toBe("2d ago");
  });
});
