// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { byCostPerTonDesc, costPerTon } from "@reef/shared";
import { installBrowserShims, renderScreen } from "./helpers";

// Two sites this month: Kriel produced 400 t; Ogies had a R5 000 repair but produced nothing.
const today = new Date();
const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
const KRIEL = { id: "22222222-0000-0000-0000-000000000001", name: "Kriel" };
const OGIES = { id: "22222222-0000-0000-0000-000000000002", name: "Ogies" };
const SCREEN = { id: "33333333-0000-0000-0000-000000000001", name: "Screen 2", mine_id: OGIES.id };

let production: unknown[] = [];
const maintenance = [{ id: "m1", equipment_id: SCREEN.id, date: thisMonth, total_cost: 5000 }];

vi.mock("@/lib/api", () => ({
  api: async () => ({ data: {} }),
  apiListAll: async (path: string) => {
    if (path.includes("/mines")) return [KRIEL, OGIES];
    if (path.includes("/production-logs")) return production;
    if (path.includes("/maintenance-logs")) return maintenance;
    return [];
  },
  fetchMe: async () => ({ id: "owner-1", role: "owner" }),
  ApiRequestError: class extends Error {},
}));

vi.mock("@/integrations/supabase/client", () => {
  const rows: Record<string, unknown[]> = { equipment: [SCREEN] };
  const query = (table: string) => ({
    select: () => query(table),
    order: async () => ({ data: rows[table] ?? [], error: null }),
  });
  return { supabase: { from: (table: string) => query(table) } };
});

async function pageOf(file: string) {
  const mod = await import(`@/routes/_authenticated/${file}.tsx`);
  return mod.Route.options.component;
}

beforeAll(() => installBrowserShims());
afterEach(() => cleanup());

describe("T18: cost per ton when nothing was produced", () => {
  it("is 'nothing', not zero, and sorts after every real figure", () => {
    expect(costPerTon(5000, 0)).toBeNull();
    expect(costPerTon(8000, 400)).toBe(20);
    expect([20, null, 35].sort(byCostPerTonDesc)).toEqual([35, 20, null]);
  });

  it("shows 'No production' for a site that produced nothing, not R 0", async () => {
    production = [{ id: "p1", mine_id: KRIEL.id, date: thisMonth, tons_produced: 400, magnetite_cost: 8000, overtime_cost: 0 }];
    await renderScreen(await pageOf("analytics"));
    const table = (await screen.findByText("Cost per ton by mine")).closest("div[class*='card'], .rounded-lg, section") ?? document.body;

    // The last cell of each row is the R / ton column.
    const rate = (row: Element) => [...row.querySelectorAll("td")].at(-1)?.textContent;
    const ogies = (await within(table as HTMLElement).findByText("Ogies")).closest("tr")!;
    expect(rate(ogies)).toBe("No production");

    const kriel = within(table as HTMLElement).getByText("Kriel").closest("tr")!;
    expect(rate(kriel)).toMatch(/^R\s*20$/);
  });

  it("shows 'No production' on the dashboard's rand-per-ton card when this month has no tonnes", async () => {
    production = [];
    await renderScreen(await pageOf("dashboard"));
    const card = (await screen.findByText(/Rand \/ Ton \(MTD\)/i)).closest("a, div")!.parentElement!;
    expect(card.textContent).toContain("No production");
  });
});
