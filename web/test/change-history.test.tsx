// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { installBrowserShims, renderScreen } from "./helpers";

// The history screen (T7) and the reason box, read the way a person and a screen reader
// would, with only the network faked.
const ME = "00000000-0000-4000-8000-000000000001";
const OTHER = "11111111-2222-4333-8444-555555555555";

const ENTRIES = [
  {
    id: "h2",
    table_name: "production_logs",
    row_id: "p1",
    changed_by: ME,
    changed_at: "2026-10-03T08:15:00Z",
    reason: "Weighbridge slip corrected",
    old_values: { tons_produced: 300 },
    new_values: { tons_produced: 310 },
    version: 3,
  },
  {
    id: "h1",
    table_name: "mines",
    row_id: "m1",
    changed_by: OTHER,
    changed_at: "2026-10-02T12:00:00Z",
    reason: "Site closed down",
    old_values: { location: "Mpumalanga", team_name: "Alpha" },
    new_values: { location: null, team_name: "Bravo" },
    version: 2,
  },
];

const requested: string[] = [];

vi.mock("@/lib/api", () => ({
  api: async (path: string) => {
    requested.push(path);
    if (path.startsWith("/api/v1/history")) {
      const table = new URL(path, "http://x").searchParams.get("table");
      return { data: ENTRIES.filter((e) => !table || e.table_name === table) };
    }
    return { data: { id: "saved" } };
  },
  apiListAll: async (path: string) =>
    path.includes("/mines") ? [{ id: "m1", name: "Kriel Pit", version: 2 }] : [],
  fetchMe: async () => ({ id: ME, role: "owner" }),
  ApiRequestError: class extends Error {},
}));
vi.mock("@/integrations/supabase/client", () => {
  const query = () => ({ select: () => query(), order: async () => ({ data: [], error: null }) });
  return { supabase: { from: () => query() } };
});
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

async function historyPage() {
  const mod = await import("@/routes/_authenticated/history.tsx");
  return renderScreen(mod.Route.options.component);
}

/** axe-core, the accessibility checker, over what is on screen. Colour contrast needs a real browser. */
async function accessibilityProblems(root: Element) {
  const result = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
  return result.violations.map(
    (v) =>
      `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
}

beforeAll(() => installBrowserShims());
afterEach(() => {
  cleanup();
  requested.length = 0;
});

describe("T7: the history screen shows reason, old value and new value together", () => {
  it("each change is one row with its reason and every field's old and new value", async () => {
    await historyPage();
    const prodRow = (await screen.findByText("Weighbridge slip corrected")).closest("tr")!;
    expect(within(prodRow).getByText("Production entry")).toBeTruthy();
    expect(within(prodRow).getByText("You")).toBeTruthy();
    expect(within(prodRow).getByText("Tons produced")).toBeTruthy();
    expect(within(prodRow).getByText("300")).toBeTruthy();
    expect(within(prodRow).getByText("310")).toBeTruthy();

    const mineRow = screen.getByText("Site closed down").closest("tr")!;
    expect(within(mineRow).getByText("Mpumalanga")).toBeTruthy();
    expect(within(mineRow).getByText("Bravo")).toBeTruthy();
    // A cleared field shows as a dash, not as the word null.
    expect(within(mineRow).queryByText("null")).toBeNull();
  });

  it("a screen reader hears each change as a sentence", async () => {
    await historyPage();
    await screen.findByText("Weighbridge slip corrected");
    expect(screen.getByText(/changed from 300 to 310/)).toBeTruthy();
    expect(screen.getByText(/changed from Mpumalanga to —/)).toBeTruthy();
  });

  it("can be narrowed to one kind of record", async () => {
    const { user } = await historyPage();
    await screen.findByText("Weighbridge slip corrected");
    await user.click(screen.getByRole("combobox", { name: "Record type" }));
    await user.click(await screen.findByRole("option", { name: "Mine" }));
    expect(await screen.findByText("Site closed down")).toBeTruthy();
    expect(screen.queryByText("Weighbridge slip corrected")).toBeNull();
    expect(requested.at(-1)).toContain("table=mines");
  });

  it("the accessibility checker finds no problems on the history screen", async () => {
    const { container } = await historyPage();
    await screen.findByText("Weighbridge slip corrected");
    expect(await accessibilityProblems(container)).toEqual([]);
  });
});

// The older fields in these dialogs already have problems the checker reports (their labels
// are not tied to their inputs). Those are not T7's, so the check is on the reason box itself:
// it must add nothing new.
describe("T7: the reason box adds no accessibility problems", () => {
  it("in the edit dialog, before and after its error is shown", async () => {
    const mines = await import("@/routes/_authenticated/mines.tsx");
    const { user } = await renderScreen(mines.Route.options.component);
    await user.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    const dialog = await screen.findByRole("dialog");
    const box = () =>
      within(dialog).getByRole("textbox", { name: "Reason for this change" }).parentElement!;
    expect(await accessibilityProblems(box())).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: /^Save/ }));
    await within(dialog).findByText("A reason is required when changing a record");
    expect(await accessibilityProblems(box())).toEqual([]);
  });
});
