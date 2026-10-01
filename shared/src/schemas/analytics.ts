import { z } from "zod";
import { Id } from "./common.js";

/**
 * A period is always given, never defaulted to "this month". Two people looking at a figure
 * have to be able to say what it covers, and a default that changes at midnight makes that
 * impossible to reconstruct afterwards.
 */
export const PeriodQuery = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    mine_id: Id.optional(),
  })
  .refine((q) => q.from <= q.to, { message: "from must not be after to", path: ["from"] });
export type PeriodQuery = z.infer<typeof PeriodQuery>;

/** The month a report covers, as YYYY-MM. */
export const MonthQuery = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM"),
  mine_id: Id,
});
export type MonthQuery = z.infer<typeof MonthQuery>;

/**
 * Cost per ton, with its parts kept separate.
 *
 * `cost_per_ton` is null, never 0, when nothing was produced: a site with costs and no output
 * is not the cheapest site, and a zero would put it at the top of a cheapest-first list.
 */
export type CostPerTon = {
  mine_id: string;
  mine_name: string;
  from: string;
  to: string;
  tons_produced: number;
  fixed_costs: number;
  magnetite_cost: number;
  overtime_cost: number;
  maintenance_cost: number;
  fuel_cost: number;
  total_cost: number;
  cost_per_ton: number | null;
  /** True when there is no production in the period, which is why cost_per_ton is null. */
  no_production: boolean;
};

export type ProductionPoint = { date: string; tons: number };

export type DowntimeByReason = { reason: string; hours: number };

export type MonthlyReport = {
  mine_id: string;
  mine_name: string;
  month: string;
  cost: CostPerTon;
  production: ProductionPoint[];
  downtime: DowntimeByReason[];
  /** Plain sentences built from the figures above, never from anything else. */
  narrative: string[];
};
