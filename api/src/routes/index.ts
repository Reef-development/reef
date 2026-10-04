import type { Hono } from "hono";
import { HistoryQuery, Id, MINE_SORTABLE, MineInput, MinePatch, RoleChange } from "@reef/shared";
import type { AppEnv } from "../app.js";
import { parseBody, parseWith } from "../http/body.js";
import { ok } from "../http/envelope.js";
import { ApiError } from "../http/errors.js";
import type { Registry } from "../registry.js";
import { defineRoute } from "./define.js";
import { resourceRoutes } from "./resource.js";

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
        "Returns the signed-in user's id and role, so the web app can choose which screens to show.",
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

  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: "/api/v1/users",
      access: "users:manage",
      summary:
        "Lists everyone who can sign in, with their role and plant, so the owner can see who has access and change it.",
      refuses:
        "Anyone but the owner, because the list shows every person's email and role. The database refuses it too.",
    },
    async (c) => ok(c, await c.var.repos.users.list()),
  );

  defineRoute(
    app,
    registry,
    {
      method: "PATCH",
      path: "/api/v1/users/:id/role",
      access: "users:manage",
      summary:
        "Changes one person's role to owner, manager or worker, and records why in the history.",
      refuses:
        "Anyone but the owner; a role that is not one of the three; a missing reason; an account that " +
        "does not exist; and a change that would leave nobody as owner, because then nobody could manage roles again.",
    },
    async (c) => {
      const id = parseWith(Id, c.req.param("id"));
      const { role, reason } = await parseBody(c, RoleChange);
      const user = await c.var.repos.users.setRole(id, role, reason);
      if (!user) throw new ApiError("NOT_FOUND", "That account does not exist");
      return ok(c, user);
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
}
