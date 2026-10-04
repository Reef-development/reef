import type { Hono } from "hono";
import {
  HistoryQuery,
  MINE_SORTABLE,
  MineInput,
  MinePatch,
  STOCK_SORTABLE,
  StockInput,
  StockPatch,
} from "@reef/shared";
import type { AppEnv } from "../app.js";
import { parseWith } from "../http/body.js";
import { ok } from "../http/envelope.js";
import type { Registry } from "../registry.js";
import { defineRoute } from "./define.js";
import { resourceRoutes, scopedResourceRoutes } from "./resource.js";

export function registerRoutes(app: Hono<AppEnv>, registry: Registry) {
  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: "/health",
      access: "public",
      summary:
        "Reports that the API process is up. The deploy polls it to know when to stop waiting.",
    },
    (c) => ok(c, { status: "ok" }),
  );

  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: "/api/v1/me",
      access: "signed-in",
      summary:
        "Returns the signed-in user's id, role and plant, so the web app can choose which screens to show.",
      refuses: "A missing, expired or foreign token.",
    },
    (c) => ok(c, c.var.user),
  );

  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: "/api/v1/history",
      access: "history:read",
      summary:
        "Lists changes to records, newest first, each with who made it, why, and the old and new values. " +
        "Filter by table and record to show one record's history.",
      refuses:
        "Workers, because history can show pay and personal details. A manager is not refused but sees " +
        "only changes at their own plant. Also refuses a malformed record id or a page size above 200.",
    },
    async (c) => {
      const q = parseWith(HistoryQuery, c.req.query());
      const { rows, total } = await c.var.repos.history.list(q);
      return ok(c, rows, 200, { page: q.page, pageSize: q.pageSize, total });
    },
  );

  resourceRoutes(app, registry, {
    name: "mines",
    noun: "site",
    repo: (r) => r.mines,
    input: MineInput,
    patch: MinePatch,
    sortable: MINE_SORTABLE,
    read: "mines:read",
    write: "mines:write",
    summaries: {
      list: "Lists the sites REEF operates, paged and sorted. Every role reads it to pick a site on capture forms.",
      get: "Returns one site.",
      create:
        "Adds a site. Owners and managers only, because a site carries the cost-per-ton target.",
      update: "Changes a site's details or its cost-per-ton target.",
      remove:
        "Deletes a site. Its production logs go with it; equipment and staff are unlinked, not deleted.",
    },
  });

  scopedResourceRoutes(app, registry, {
    name: "stock",
    noun: "stock item",
    repo: (r) => r.stock,
    input: StockInput,
    patch: StockPatch,
    sortable: STOCK_SORTABLE,
    read: "stock:read",
    write: "stock:write",
    summaries: {
      list: "Lists stock items for the caller's plant. An owner sees every plant; everyone else sees only their own.",
      get: "Returns one stock item, or 404 if it belongs to another plant.",
      create:
        "Adds a stock item. The plant is taken from the caller, except for an owner, who may set it.",
      update:
        "Changes a stock item's details or its levels. Refuses a save from an out-of-date copy.",
      remove: "Deletes a stock item. Refuses if the caller cannot see it.",
    },
  });
}
