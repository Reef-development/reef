/**
 * Adds the derived figures the model keeps trying to compute on its own, and a
 * `_scope` block that tells the model what the tool covers and what it does not.
 *
 * Everything derived is rounded to two decimals before it leaves this function,
 * including every field inside `previous_period`.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const safeDiv = (n: number, d: number): number | null => (d > 0 ? round2(n / d) : null);
const safePct = (n: number, total: number): number | null =>
  total > 0 ? round2((n / total) * 100) : null;

export type ProductionCostsInput = {
  window_months?: number;
  total_tons: number;
  variable_costs: number;
  maintenance_costs: number;
  static_costs: number;
  mine_count?: number;
  client_count?: number;
  static_by_category?: Record<string, number>;
  variable_by_component?: { magnetite: number; overtime: number };
  previous_period?: {
    total_tons: number;
    cost_per_ton: number | null;
    static_costs: number;
    variable_costs: number;
    maintenance_costs: number;
    total_cost: number;
    cost_per_ton_change_pct?: number | null;
    cost_per_ton_delta?: number | null;
  };
  dataNotes?: string[];
  [key: string]: unknown;
};

export function withDerivedCosts<T extends ProductionCostsInput>(data: T) {
  const totalCost = data.variable_costs + data.maintenance_costs + data.static_costs;
  const tonnes = data.total_tons;

  const staticByCategory = data.static_by_category
    ? Object.fromEntries(Object.entries(data.static_by_category).map(([k, v]) => [k, round2(v)]))
    : undefined;

  const variableByComponent = data.variable_by_component
    ? {
        magnetite: round2(data.variable_by_component.magnetite),
        overtime: round2(data.variable_by_component.overtime),
      }
    : undefined;

  const pp = data.previous_period;
  const previousPeriod = pp
    ? {
        total_tons: round2(pp.total_tons),
        cost_per_ton: pp.cost_per_ton == null ? null : round2(pp.cost_per_ton),
        static_costs: round2(pp.static_costs),
        variable_costs: round2(pp.variable_costs),
        maintenance_costs: round2(pp.maintenance_costs),
        total_cost: round2(pp.total_cost),
        cost_per_ton_change_pct:
          pp.cost_per_ton_change_pct == null ? null : round2(pp.cost_per_ton_change_pct),
        cost_per_ton_delta:
          pp.cost_per_ton_delta == null ? null : round2(pp.cost_per_ton_delta),
      }
    : undefined;

  return {
    ...data,
    total_tons: round2(data.total_tons),
    variable_costs: round2(data.variable_costs),
    maintenance_costs: round2(data.maintenance_costs),
    static_costs: round2(data.static_costs),
    total_cost: round2(totalCost),
    cost_per_ton: safeDiv(totalCost, tonnes),
    static_per_ton: safeDiv(data.static_costs, tonnes),
    variable_per_ton: safeDiv(data.variable_costs, tonnes),
    maintenance_per_ton: safeDiv(data.maintenance_costs, tonnes),
    static_share_pct: safePct(data.static_costs, totalCost),
    variable_share_pct: safePct(data.variable_costs, totalCost),
    maintenance_share_pct: safePct(data.maintenance_costs, totalCost),
    static_by_category: staticByCategory,
    variable_by_component: variableByComponent,
    previous_period: previousPeriod,
    dataNotes: data.dataNotes ?? [],
    _scope: {
      covers:
        "site-wide totals across all mines for the last N completed calendar months: tonnes produced, variable costs (split into magnetite and overtime), maintenance costs, static costs (grouped by category), cost per ton, share of total for each category, the previous N months' totals, and the change in cost per ton for month-on-month comparison",
      doesNotCover: [
        "partial current-month data (the window ends at the last completed month)",
        "per-equipment or per-asset costs (no way to isolate one machine, vehicle, or asset)",
        "per-mine cost breakdowns (only the sum across all mines)",
        "cost items beyond the categories returned in static_by_category and variable_by_component",
        "any question about an item (equipment, vehicle, site, person) not listed in the output",
      ],
    },
  };
}