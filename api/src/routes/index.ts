import type { Hono } from "hono";
import { z } from "zod";
import {
  HistoryQuery,
  Id,
  MINE_SORTABLE,
  MineInput,
  MinePatch,
  PURCHASE_ORDER_SORTABLE,
  PurchaseOrderInput,
  PurchaseOrderPatch,
  RoleChange,
  STOCK_LEVEL_SORTABLE,
  STOCK_SORTABLE,
  StockInput,
  StockLevelInput,
  StockLevelPatch,
  StockPatch,
} from "@reef/shared";
import type { AppEnv } from "../app.js";
import { parseBody, parseWith } from "../http/body.js";
import { ok } from "../http/envelope.js";
import { ApiError } from "../http/errors.js";
import type { Registry } from "../registry.js";
import { dailyOpsRoutes } from "./daily-ops.js";
import { adminRoutes } from "./admin.js";
import { analyticsRoutes } from "./analytics.js";
import { purchasingRoutes } from "./purchasing.js";
import { defineRoute } from "./define.js";
import { notificationRoutes } from "./notifications.js";
import { resourceRoutes, scopedResourceRoutes } from "./resource.js";
import { settingsRoutes } from "./settings.js";

const UserId = z.string().uuid();
const SessionId = z.string().uuid();

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
    (c) =>
      ok(c, {
        id: c.var.user.id,
        role: c.var.user.role,
        plant: c.var.user.plant,
      }),
  );

  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: "/api/v1/sessions",
      access: "signed-in",
      summary:
        "Lists the signed-in user's active sign-ins, including device, address and last use.",
      refuses: "A missing, expired, foreign or revoked token.",
    },
    async (c) => {
      const sessions = await c.var.repos.sessions.forUser(c.var.user.id);

      return ok(
        c,
        sessions.filter((session) => session.revoked_at === null),
      );
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: "/api/v1/users/:userId/sessions",
      access: "sessions:manage",
      summary:
        "Lets an owner view another user's active sign-ins, including device, address and last use.",
      refuses: "A user id that is not a UUID, or a caller who is not an owner.",
    },
    async (c) => {
      const userId = parseWith(UserId, c.req.param("userId"));

      const sessions = await c.var.repos.sessions.forUser(userId);

      return ok(
        c,
        sessions.filter((session) => session.revoked_at === null),
      );
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "DELETE",
      path: "/api/v1/sessions/:sessionId",
      access: "sessions:manage",
      summary: "Lets an owner cut off one active sign-in.",
      refuses:
        "A session id that is not a UUID, a session that does not exist or is already revoked, or a caller who is not an owner.",
    },
    async (c) => {
      const sessionId = parseWith(SessionId, c.req.param("sessionId"));

      const revoked = await c.var.repos.sessions.revoke(sessionId);

      if (!revoked) {
        throw new ApiError("NOT_FOUND", "That sign-in does not exist or has already been revoked");
      }

      return ok(c, {
        sessionId,
        revoked: true,
      });
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "DELETE",
      path: "/api/v1/users/:userId/sessions",
      access: "sessions:manage",
      summary: "Lets an owner cut off all active sign-ins belonging to one user.",
      refuses: "A user id that is not a UUID, or a caller who is not an owner.",
    },
    async (c) => {
      const userId = parseWith(UserId, c.req.param("userId"));

      const revokedCount = await c.var.repos.sessions.revokeAll(userId);

      return ok(c, {
        userId,
        revokedCount,
      });
    },
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

  dailyOpsRoutes(app, registry);
  purchasingRoutes(app, registry);
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

  scopedResourceRoutes(app, registry, {
    name: "stock-levels",
    noun: "stock level",
    repo: (r) => r.stockLevels,
    input: StockLevelInput,
    patch: StockLevelPatch,
    sortable: STOCK_LEVEL_SORTABLE,
    read: "stock:read",
    write: "stock:write",
    summaries: {
      list: "Lists stock levels for the caller's plant. An owner sees every plant; everyone else sees only their own.",
      get: "Returns one stock level, or 404 if it belongs to another plant.",
      create:
        "Adds a stock level for a part at a plant. The plant is taken from the caller, except for an owner, who may set it.",
      update:
        "Changes a stock level's quantity or its reorder thresholds. Refuses a save from an out-of-date copy.",
      remove: "Deletes a stock level. Refuses if the caller cannot see it.",
    },
  });

  scopedResourceRoutes(app, registry, {
    name: "purchase-orders",
    noun: "purchase order",
    repo: (r) => r.purchaseOrders,
    input: PurchaseOrderInput,
    patch: PurchaseOrderPatch,
    sortable: PURCHASE_ORDER_SORTABLE,
    read: "po:read",
    write: "po:write",
    summaries: {
      list: "Lists purchase orders for the caller's plant. Only owners and managers can call this — employees cannot see purchase orders. An owner sees every plant.",
      get: "Returns one purchase order, or 404 if it belongs to another plant.",
      create:
        "Raises a purchase order. Only owners and managers can call this. The plant is taken from the caller, except for an owner, who may raise one for any plant.",
      update:
        "Changes a purchase order's details or its status. Refuses a save from an out-of-date copy.",
      remove: "Deletes a purchase order. Refuses if the caller cannot see it.",
    },
  });

  analyticsRoutes(app, registry);
  adminRoutes(app, registry);
  notificationRoutes(app, registry);
  settingsRoutes(app, registry);
}
