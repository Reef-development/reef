import type { Hono } from "hono";
import { AsOfQuery, DEFAULT_RETENTION } from "@reef/shared";
import type { AppEnv } from "../app.js";
import { parseWith } from "../http/body.js";
import { ok } from "../http/envelope.js";
import type { Registry } from "../registry.js";
import { retentionPlan } from "../services/retention.js";
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
}
