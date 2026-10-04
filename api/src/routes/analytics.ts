import type { Hono } from "hono";
import { MonthQuery, PeriodQuery, type MonthlyReport } from "@reef/shared";
import type { AppEnv } from "../app.js";
import { parseWith } from "../http/body.js";
import { ok } from "../http/envelope.js";
import { ApiError } from "../http/errors.js";
import type { Registry } from "../registry.js";
import type { Period } from "../repositories/types.js";
import { costPerTon, rankByCostPerTon } from "../services/cost.js";
import { exportFilename, toCsv } from "../services/csv.js";
import { defineRoute } from "./define.js";

/** The whole month a YYYY-MM names, as an inclusive period. */
function monthPeriod(month: string): Period {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from: `${month}-01`, to: last };
}

async function oneSite(c: { var: AppEnv["Variables"] }, mineId?: string) {
  const mines = await c.var.repos.analytics.mines();
  const chosen = mineId ? mines.find((m) => m.id === mineId) : mines[0];
  // A site outside what the caller may see is absent from that list, so this answers "not
  // found" rather than "not allowed". Saying "not allowed" would confirm the site exists.
  if (!chosen) throw new ApiError("NOT_FOUND", "That site does not exist or has been removed");
  return chosen;
}

/** The month-end report, built once and served both as figures and as a spreadsheet. */
async function monthlyReport(
  c: { var: AppEnv["Variables"] },
  q: MonthQuery,
): Promise<MonthlyReport> {
  const mine = await oneSite(c, q.mine_id);
  const period = monthPeriod(q.month);
  const analytics = c.var.repos.analytics;

  const [cost, production, downtime] = await Promise.all([
    costPerTon(analytics, mine, period),
    analytics.productionByDay(mine.id, period),
    analytics.downtimeHours(mine.id, period),
  ]);

  const narrative: string[] = [
    cost.cost_per_ton === null
      ? `${mine.name} recorded no production in ${q.month}, so there is no cost per ton for the month.`
      : `${mine.name} produced ${cost.tons_produced.toFixed(2)} tons in ${q.month} at R ${cost.cost_per_ton.toFixed(2)} per ton.`,
    `Costs were R ${cost.fixed_costs.toFixed(2)} fixed and R ${(cost.total_cost - cost.fixed_costs).toFixed(2)} variable.`,
  ];
  const worst = downtime[0];
  if (worst) {
    narrative.push(
      `The largest cause of downtime was ${worst.reason.replace(/_/g, " ")}, at ${worst.hours.toFixed(2)} hours.`,
    );
  }

  return {
    mine_id: mine.id,
    mine_name: mine.name,
    month: q.month,
    cost,
    production,
    downtime,
    narrative,
  };
}

export function analyticsRoutes(app: Hono<AppEnv>, registry: Registry) {
  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: "/api/v1/analytics/cost-per-ton",
      access: "analytics:read",
      summary:
        "Cost per ton for one site over a period, with fixed and variable costs kept apart so a rise can be attributed rather than only noticed.",
      refuses:
        "A period without both dates, or one that runs backwards. A site the caller may not see answers 404 rather than 403, because 403 would confirm it exists. A period with no production returns null rather than 0: a site that produced nothing is not the cheapest site.",
    },
    async (c) => {
      const q = parseWith(PeriodQuery, c.req.query());
      const mine = await oneSite(c, q.mine_id);
      return ok(c, await costPerTon(c.var.repos.analytics, mine, { from: q.from, to: q.to }));
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: "/api/v1/analytics/comparison",
      access: "analytics:compare",
      summary:
        "Every site the caller may see, ranked by cost per ton, cheapest first. The owner's view of which plant is running expensively.",
      refuses:
        "A manager, who sees their own sites' figures but not the ranking: that would tell them how another manager's site is doing. Sites with no production sort last, not first, because they have no cost per ton at all.",
    },
    async (c) => {
      const q = parseWith(PeriodQuery, c.req.query());
      const period = { from: q.from, to: q.to };
      const mines = await c.var.repos.analytics.mines();
      const rows = await Promise.all(
        mines.map((mine) => costPerTon(c.var.repos.analytics, mine, period)),
      );
      return ok(c, rankByCostPerTon(rows));
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: "/api/v1/analytics/production-trend",
      access: "analytics:read",
      summary:
        "Tons produced per day for one site, which is the series behind the production chart.",
      refuses:
        "The same period and site rules as cost per ton. A day with no shift recorded is absent from the series rather than present as a zero, because zero means nothing was produced and absent means nobody captured anything.",
    },
    async (c) => {
      const q = parseWith(PeriodQuery, c.req.query());
      const mine = await oneSite(c, q.mine_id);
      const points = await c.var.repos.analytics.productionByDay(mine.id, {
        from: q.from,
        to: q.to,
      });
      return ok(c, { mine_id: mine.id, mine_name: mine.name, points });
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: "/api/v1/reports/monthly",
      access: "reports:read",
      summary:
        "The month-end report for one site: cost per ton with its parts, production day by day, downtime by cause, and a short narrative written from those figures.",
      refuses:
        "A month that is not YYYY-MM, and a site the caller may not see. The narrative is built from the figures in the same response and contains no number that is not in them, so the two can never disagree.",
    },
    async (c) => {
      const q = parseWith(MonthQuery, c.req.query());
      return ok(c, await monthlyReport(c, q));
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: "/api/v1/reports/monthly.csv",
      access: "reports:read",
      summary:
        "The same month-end report as a spreadsheet, for sending on. One row per day with the month's cost figures repeated, so a row stands on its own once it has been sorted or filtered.",
      refuses:
        "The same month and site rules as the report itself. The file opens with a byte order mark and uses carriage returns, because Excel needs both; a cell that starts with an equals sign is written as text, so a note typed by a worker cannot become a formula the spreadsheet runs.",
    },
    async (c) => {
      const q = parseWith(MonthQuery, c.req.query());
      const report = await monthlyReport(c, q);
      const body = toCsv(report.production, [
        { header: "Site", value: () => report.mine_name },
        { header: "Month", value: () => report.month },
        { header: "Date", value: (r) => r.date },
        { header: "Tons produced", value: (r) => r.tons.toFixed(2) },
        { header: "Cost per ton (R)", value: () => report.cost.cost_per_ton?.toFixed(2) ?? "" },
        { header: "Fixed costs (R)", value: () => report.cost.fixed_costs.toFixed(2) },
        { header: "Total cost (R)", value: () => report.cost.total_cost.toFixed(2) },
      ]);
      const name = exportFilename("reef-monthly", [report.mine_name, report.month]);
      c.header("Content-Type", "text/csv; charset=utf-8");
      c.header("Content-Disposition", `attachment; filename="${name}"`);
      return c.body(body);
    },
  );
}
