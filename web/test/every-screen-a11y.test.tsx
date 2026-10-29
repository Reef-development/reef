// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import axe from "axe-core";
import { installBrowserShims, renderScreen } from "./helpers";

// T20: axe-core, the accessibility checker, over every screen in the web app, manager and
// worker, with realistic data on screen. The sheet asks for no serious or critical problems;
// colour contrast needs a real browser and real styles, so it is checked by hand in both themes.

const MINE = {
  id: "m1",
  name: "Highveld North Pit",
  target_cost_per_ton: 45,
  client_id: "c1",
  version: 1,
};
const ROWS: Record<string, unknown[]> = {
  mines: [MINE],
  clients: [{ id: "c1", name: "Seriti", active: true, contract_revenue_monthly: 100000 }],
  equipment: [
    {
      id: "e1",
      name: "Conveyor CV-201",
      mine_id: "m1",
      tons_since_install: 10,
      expected_life_tons: 100,
    },
  ],
  suppliers: [{ id: "s1", name: "Bearings SA" }],
  stock_items: [
    {
      id: "i1",
      name: "Bearing 6205",
      qty_on_hand: 3,
      reorder_point: 4,
      reorder_qty: 10,
      unit_cost: 150,
      unit: "unit",
    },
  ],
  purchase_orders: [
    {
      id: "po1",
      status: "draft",
      total_cost: 1500,
      created_at: "2026-10-01T08:00:00Z",
      supplier_id: "s1",
    },
  ],
  production_logs: [
    {
      id: "p1",
      mine_id: "m1",
      date: "2026-10-01",
      shift: "morning",
      tons_produced: 300,
      magnetite_cost: 100,
      overtime_cost: 50,
      version: 1,
    },
  ],
  fuel_slips: [
    {
      id: "f1",
      date: "2026-10-01",
      litres: 40,
      cost_per_litre: 22,
      total_cost: 880,
      fuel_type: "diesel",
      mine_id: "m1",
      version: 1,
    },
  ],
  maintenance_logs: [
    {
      id: "r1",
      equipment_id: "e1",
      date: "2026-10-01",
      description: "Belt",
      total_cost: 900,
      parts_cost: 300,
      labour_cost: 600,
      version: 1,
    },
  ],
  static_costs: [{ id: "sc1", mine_id: "m1", month: "2026-10-01", category: "rent", amount: 1000 }],
  downtime_events: [
    {
      id: "d1",
      mine_id: "m1",
      equipment_id: "e1",
      reason: "breakdown",
      duration_hours: 2,
      started_at: "2026-10-01T08:00:00Z",
    },
  ],
  employees: [
    {
      id: "w1",
      full_name: "Sipho Dlamini",
      mine_id: "m1",
      shift: "morning",
      position: "Operator",
      active: true,
      hourly_rate: 80,
    },
  ],
  attendance: [],
  employee_transfers: [],
};
const API_TABLE: Record<string, string> = {
  "/api/v1/mines": "mines",
  "/api/v1/production-logs": "production_logs",
  "/api/v1/fuel-slips": "fuel_slips",
  "/api/v1/maintenance-logs": "maintenance_logs",
};

vi.mock("@/lib/api", () => ({
  api: async () => ({ data: { id: "saved" } }),
  apiListAll: async (path: string) => ROWS[API_TABLE[path]] ?? [],
  fetchMe: async () => ({ id: "owner-1", role: "owner" }),
  ApiRequestError: class extends Error {},
}));
vi.mock("@/integrations/supabase/client", () => {
  const query = (table: string): Record<string, unknown> => {
    const result = { data: ROWS[table] ?? [], error: null };
    const chain: Record<string, unknown> = {
      then: (resolve: (v: unknown) => void) => resolve(result),
    };
    for (const m of ["select", "order", "eq", "gte", "lte", "in", "limit", "range"])
      chain[m] = () => chain;
    chain.single = async () => ({ data: (ROWS[table] ?? [])[0] ?? null, error: null });
    chain.maybeSingle = chain.single;
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => query(table),
      auth: {
        getUser: async () => ({ data: { user: { id: "owner-1" } } }),
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock("@/hooks/useCaptureLimit", () => ({
  useCaptureLimit: () => ({ days: 60, today: "2026-10-02", earliest: "2026-08-03" }),
}));

const SCREENS: Record<string, () => Promise<{ Route: { options: { component?: unknown } } }>> = {
  "manager: dashboard": () => import("@/routes/_authenticated/dashboard.tsx"),
  "manager: cost analytics": () => import("@/routes/_authenticated/analytics.tsx"),
  "manager: clients": () => import("@/routes/_authenticated/clients.tsx"),
  "manager: employees": () => import("@/routes/_authenticated/employees/index.tsx"),
  "manager: mines": () => import("@/routes/_authenticated/mines.tsx"),
  "manager: equipment": () => import("@/routes/_authenticated/equipment.tsx"),
  "manager: maintenance": () => import("@/routes/_authenticated/maintenance.tsx"),
  "manager: downtime": () => import("@/routes/_authenticated/downtime.tsx"),
  "manager: inventory": () => import("@/routes/_authenticated/inventory.tsx"),
  "manager: suppliers": () => import("@/routes/_authenticated/suppliers.tsx"),
  "manager: purchase orders": () => import("@/routes/_authenticated/purchase-orders.tsx"),
  "manager: production": () => import("@/routes/_authenticated/production.tsx"),
  "manager: fuel slips": () => import("@/routes/_authenticated/fuel.tsx"),
  "manager: static costs": () => import("@/routes/_authenticated/static-costs.tsx"),
  "worker: home": () => import("@/routes/worker/index.tsx"),
  "worker: log production": () => import("@/routes/worker/log-production.tsx"),
  "worker: log fuel": () => import("@/routes/worker/log-fuel.tsx"),
  "worker: log repair": () => import("@/routes/worker/log-repair.tsx"),
  "worker: log downtime": () => import("@/routes/worker/log-downtime.tsx"),
  "worker: log usage": () => import("@/routes/worker/log-usage.tsx"),
  "sign in": () => import("@/routes/auth.tsx"),
};

/** Serious and critical problems only, as the sheet asks. */
async function seriousProblems(root: Element) {
  const { violations } = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

beforeAll(() => installBrowserShims());
afterEach(() => cleanup());

describe("T20: no serious or critical accessibility problems on any web screen", () => {
  it.each(Object.keys(SCREENS))("%s", async (name) => {
    const mod = await SCREENS[name]();
    const { container } = await renderScreen(mod.Route.options.component as never);
    // Let the data arrive and the screen settle before checking it.
    await screen.findAllByRole("heading");
    await new Promise((r) => setTimeout(r, 50));
    const problems = await seriousProblems(container);
    // Printed so a failure names the element, not just the count.
    if (problems.length) console.log(`A11Y ${name}: ${problems.join(" | ")}`);
    expect(problems).toEqual([]);
  });
});
