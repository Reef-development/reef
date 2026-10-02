import type { Hono } from "hono";
import {
  CLIENT_SORTABLE,
  ClientInput,
  ClientPatch,
  MINE_SORTABLE,
  MineInput,
  MinePatch,
  SUPPLIER_SORTABLE,
  SupplierInput,
  SupplierPatch,
} from "@reef/shared";
import type { AppEnv } from "../app.js";
import { ok } from "../http/envelope.js";
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
        "Returns the signed-in user's id, role and plant, so the web app can choose which screens to show.",
      refuses: "A missing, expired or foreign token.",
    },
    (c) => ok(c, c.var.user),
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
}
