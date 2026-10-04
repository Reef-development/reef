import type { Hono } from "hono";
import {
  CLIENT_SORTABLE,
  ClientInput,
  ClientPatch,
  HistoryQuery,
  MINE_SORTABLE,
  MineInput,
  MinePatch,
  PURCHASE_ORDER_SORTABLE,
  PurchaseOrderInput,
  PurchaseOrderPatch,
  STOCK_LEVEL_SORTABLE,
  STOCK_SORTABLE,
  StockInput,
  StockLevelInput,
  StockLevelPatch,
  StockPatch,
  SUPPLIER_SORTABLE,
  SupplierInput,
  SupplierPatch,
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

  resourceRoutes(app, registry, {
    name: "suppliers",
    noun: "supplier",
    repo: (r) => r.suppliers,
    input: SupplierInput,
    patch: SupplierPatch,
    sortable: SUPPLIER_SORTABLE,
    read: "suppliers:read",
    write: "suppliers:write",
    summaries: {
      list: "Lists the vendors REEF buys stock from, paged and sorted. Owners and managers only, because a supplier carries contact and cost information.",
      get: "Returns one supplier.",
      create: "Adds a supplier. Owners and managers only.",
      update:
        "Changes a supplier's details. Refuses a save from an out-of-date copy, so nobody overwrites a change they never saw.",
      remove: "Deletes a supplier. Refuses if a purchase order still points to it.",
    },
  });

  resourceRoutes(app, registry, {
    name: "clients",
    noun: "client",
    repo: (r) => r.clients,
    input: ClientInput,
    patch: ClientPatch,
    sortable: CLIENT_SORTABLE,
    read: "clients:read",
    write: "clients:write",
    summaries: {
      list: "Lists the companies that contract REEF to operate at their mines, paged and sorted. Owners and managers only, because a client carries contract and revenue information.",
      get: "Returns one client.",
      create: "Adds a client. Owners and managers only.",
      update:
        "Changes a client's details or contract. Refuses a save from an out-of-date copy, so nobody overwrites a change they never saw.",
      remove: "Deletes a client. Refuses if a mine still points to it.",
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
      list: "Lists per-plant stock levels. An owner sees every plant; everyone else sees only their own.",
      get: "Returns one stock level, or 404 if it belongs to another plant.",
      create:
        "Adds a stock level. The plant is taken from the caller, except for an owner, who may set it.",
      update:
        "Changes a stock level. Refuses a save from an out-of-date copy, so nobody overwrites a change they never saw.",
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
      list: "Lists purchase orders for the caller's plant. Owners and managers only — a worker cannot place orders.",
      get: "Returns one purchase order, or 404 if it belongs to another plant.",
      create: "Adds a purchase order. Managers and owners only.",
      update:
        "Changes a purchase order's status or details. Refuses a save from an out-of-date copy.",
      remove: "Deletes a purchase order. Refuses if the caller cannot see it.",
    },
  });
}
