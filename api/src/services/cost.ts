import type { CostPerTon } from "@reef/shared";
import type { AnalyticsRepository, Period } from "../repositories/types.js";

/** Rounds money to cents, so two figures built the same way cannot differ in the last digit. */
export function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Cost per ton for one site over one period (FR-17).
 *
 * Two things here are decisions rather than arithmetic, and both are deliberate.
 *
 * Fixed and variable costs are kept apart all the way through. A single total hides which of
 * them moved, and a rise in cost per ton that nobody can attribute is a figure nobody acts on.
 *
 * A period with no production returns null, never 0. Zero would read as "this site was free"
 * and would sort to the top of a cheapest-first comparison, which is the opposite of the truth.
 */
export async function costPerTon(
  analytics: AnalyticsRepository,
  mine: { id: string; name: string },
  period: Period,
): Promise<CostPerTon> {
  const [production, fixed, maintenance, fuel] = await Promise.all([
    analytics.productionTotals(mine.id, period),
    analytics.fixedCosts(mine.id, period),
    analytics.maintenanceCost(mine.id, period),
    analytics.fuelCost(mine.id, period),
  ]);

  const total = fixed + production.magnetiteCost + production.overtimeCost + maintenance + fuel;

  return {
    mine_id: mine.id,
    mine_name: mine.name,
    from: period.from,
    to: period.to,
    tons_produced: money(production.tons),
    fixed_costs: money(fixed),
    magnetite_cost: money(production.magnetiteCost),
    overtime_cost: money(production.overtimeCost),
    maintenance_cost: money(maintenance),
    fuel_cost: money(fuel),
    total_cost: money(total),
    cost_per_ton: production.tons > 0 ? money(total / production.tons) : null,
    no_production: production.tons <= 0,
  };
}

/**
 * Cheapest first, with the sites that produced nothing last rather than first. They have no
 * cost per ton at all, and putting them at the top because null sorts low is the single
 * easiest way to make this table lie.
 */
export function rankByCostPerTon(rows: CostPerTon[]): CostPerTon[] {
  return [...rows].sort((a, b) => {
    if (a.cost_per_ton === null && b.cost_per_ton === null) {
      return a.mine_name.localeCompare(b.mine_name);
    }
    if (a.cost_per_ton === null) return 1;
    if (b.cost_per_ton === null) return -1;
    return a.cost_per_ton - b.cost_per_ton;
  });
}
