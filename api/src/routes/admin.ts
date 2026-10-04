import type { Hono } from "hono";
import { AsOfQuery, DEFAULT_RETENTION, JobQuery } from "@reef/shared";
import type { AppEnv } from "../app.js";
import { parseWith } from "../http/body.js";
import { ok } from "../http/envelope.js";
import type { Registry } from "../registry.js";
import { retentionPlan } from "../services/retention.js";
import { SERVICE_SWEEP, report } from "../services/scheduler.js";
import { defineRoute } from "./define.js";

export function adminRoutes(app: Hono<AppEnv>, registry: Registry) {
  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: "/api/v1/admin/retention",
      access: "retention:read",
      summary:
        "What the retention rules REEF gave say about everyone who has left: when each person's identity number falls due for removal, and when the rest of their record does. Answers as at a date, so a future date can be asked about.",
      refuses:
        "Anyone but the owner, because it is a list of people who have left. An as_of that is not a date. It never returns an identity number: it reports only whether one is still stored, which is all the question needs.",
    },
    async (c) => {
      const q = parseWith(AsOfQuery, c.req.query());
      const asOf = q.as_of ?? new Date().toISOString().slice(0, 10);
      const years = c.var.deps.retention ?? DEFAULT_RETENTION;
      const leavers = await c.var.repos.retention.leavers();
      return ok(c, retentionPlan(leavers, years, asOf));
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: "/api/v1/admin/jobs",
      access: "jobs:read",
      summary:
        "Whether the scheduled service sweep has been running, day by day, with the days it did not run listed separately. Defaults to the last thirty days.",
      refuses:
        "Anyone but the owner. The field that matters is `missed`: a day the sweep did not run raises no error and writes no log line anywhere else, so a missing row is the only evidence it exists.",
    },
    async (c) => {
      const q = parseWith(JobQuery, c.req.query());
      const today = new Date().toISOString().slice(0, 10);
      const to = q.to ?? today;
      const from = defaultFrom(to, q.from);
      const runs = await c.var.repos.jobs.runs(SERVICE_SWEEP, from, to);
      return ok(c, report(SERVICE_SWEEP, from, to, runs));
    },
  );
}

/** Thirty days back, unless a start date was given. */
function defaultFrom(to: string, given?: string): string {
  if (given) return given;
  return new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
}
