import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import {
  FUEL_SORTABLE,
  FuelInput,
  FuelPatch,
  Id,
  MAINTENANCE_SORTABLE,
  MaintenanceInput,
  MaintenancePartInput,
  MaintenancePatch,
  PRODUCTION_SORTABLE,
  PhotoPath,
  PhotoUploadInput,
  ProductionInput,
  ProductionPatch,
  StockUsageInput,
} from "@reef/shared";
import type { AppEnv } from "../app.js";
import { parseBody, parseWith } from "../http/body.js";
import { ok } from "../http/envelope.js";
import { ApiError } from "../http/errors.js";
import type { Registry } from "../registry.js";
import { defineRoute } from "./define.js";
import { resourceRoutes } from "./resource.js";

const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

/** Maintenance and daily operations: what workers capture on the plant, and what managers correct. */
export function dailyOpsRoutes(app: Hono<AppEnv>, registry: Registry) {
  resourceRoutes(app, registry, {
    name: "production-logs",
    noun: "production entry",
    repo: (r) => r.production,
    input: ProductionInput,
    patch: ProductionPatch,
    sortable: PRODUCTION_SORTABLE,
    read: "production:read",
    create: "production:create",
    write: "production:write",
    summaries: {
      list: "Lists tonnage captured per site and shift, newest first by default. Feeds the cost-per-ton figures.",
      get: "Returns one production entry.",
      create: "Captures tons produced for a site. Every role may capture, because workers record output on the plant.",
      update: "Corrects a production entry. Managers and owners only, because it changes cost per ton after the fact.",
      remove: "Deletes a production entry captured in error. Managers and owners only.",
    },
    createRefuses: "A negative tonnage or a site id that is not a UUID.",
  });

  resourceRoutes(app, registry, {
    name: "fuel-slips",
    noun: "fuel slip",
    repo: (r) => r.fuel,
    input: FuelInput,
    patch: FuelPatch,
    sortable: FUEL_SORTABLE,
    read: "fuel:read",
    create: "fuel:create",
    write: "fuel:write",
    remove: "fuel:delete",
    stampUser: "logged_by",
    summaries: {
      list: "Lists fuel slips, newest first by default.",
      get: "Returns one fuel slip.",
      create:
        "Captures a fuel slip. The database works out the total from litres and price, so a total sent by the client is refused rather than trusted.",
      update: "Corrects a fuel slip; the total is recalculated. Managers and owners only.",
      remove: "Deletes a fuel slip. Owners only, because slips are evidence for fuel spend.",
    },
    createRefuses: "Zero litres, a total_cost field, a photo path this system did not issue, or neither a vehicle nor a label.",
  });

  resourceRoutes(app, registry, {
    name: "maintenance-logs",
    noun: "repair",
    repo: (r) => r.maintenance,
    input: MaintenanceInput,
    patch: MaintenancePatch,
    sortable: MAINTENANCE_SORTABLE,
    read: "maintenance:read",
    create: "maintenance:create",
    write: "maintenance:write",
    summaries: {
      list: "Lists repairs, newest first by default, with labour, parts and total cost.",
      get: "Returns one repair.",
      create:
        "Logs a repair and the parts it used in one step: either all of it is saved or none. Stock comes off, a reorder is drafted if an item runs low, and the caller is recorded as the person who logged it.",
      update: "Corrects a repair's details. Parts change through their own endpoints. Managers and owners only.",
      remove: "Deletes a repair logged in error. Managers and owners only.",
    },
    createRefuses: "A missing description or equipment, a cost field (costs are worked out from labour and parts), or more than 50 parts.",
  });

  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: "/api/v1/maintenance-logs/:id/parts",
      access: "maintenance:read",
      summary: "Lists the parts a repair used, with each stock item's name and unit.",
      refuses: "An id that is not a UUID.",
    },
    async (c) => {
      const id = parseWith(Id, c.req.param("id"));
      return ok(c, await c.var.repos.maintenanceParts.forLog(id));
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "POST",
      path: "/api/v1/maintenance-logs/:id/parts",
      access: "maintenance:write",
      summary: "Adds a part to a repair already logged. Stock comes off and the repair's cost goes up.",
      refuses: "A zero quantity, or a repair or stock item that does not exist. Managers and owners only.",
    },
    async (c) => {
      const id = parseWith(Id, c.req.param("id"));
      const part = await parseBody(c, MaintenancePartInput);
      if (!(await c.var.repos.maintenance.get(id))) throw new ApiError("NOT_FOUND", "That repair does not exist");
      return ok(c, await c.var.repos.maintenanceParts.add(id, part), 201);
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "DELETE",
      path: "/api/v1/maintenance-parts/:id",
      access: "maintenance:write",
      summary: "Removes a part logged against a repair in error. It goes back on the shelf and off the repair's cost.",
      refuses: "A part that does not exist. Managers and owners only.",
    },
    async (c) => {
      const id = parseWith(Id, c.req.param("id"));
      if (!(await c.var.repos.maintenanceParts.remove(id))) throw new ApiError("NOT_FOUND", "That part does not exist");
      return ok(c, { id, deleted: true });
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "POST",
      path: "/api/v1/stock-usage",
      access: "stock:use",
      summary:
        "Records stock used on the plant. The quantity comes off in one database step, so two people recording at once both count, and a reorder is drafted if the item falls to its reorder point.",
      refuses: "A zero or negative quantity, or a stock item that does not exist.",
    },
    async (c) => {
      const { stock_item_id, qty } = await parseBody(c, StockUsageInput);
      return ok(c, await c.var.repos.stockUsage.recordUsage(stock_item_id, qty));
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "POST",
      path: "/api/v1/photos/upload-url",
      access: "photos:upload",
      summary:
        "Issues a one-time link for uploading a repair, fuel or downtime photo. The API chooses the file name, under the caller's own folder, so nobody can overwrite another person's photo.",
      refuses: "Anything other than a JPEG, PNG or WebP image, or an unknown folder.",
    },
    async (c) => {
      const { folder, content_type } = await parseBody(c, PhotoUploadInput);
      const path = `${folder}/${c.var.user.id}/${Date.now()}-${randomUUID().slice(0, 8)}.${EXTENSIONS[content_type]}`;
      return ok(c, { path, ...(await c.var.repos.photos.uploadUrl(path)) }, 201);
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: "/api/v1/photos/view",
      access: "photos:view",
      summary: "Returns a link to view a stored photo for one hour.",
      refuses:
        "A path this system did not issue, or a photo the caller may not see: workers see their own, managers and owners see all.",
    },
    async (c) => {
      const path = parseWith(PhotoPath, c.req.query("path"));
      const url = await c.var.repos.photos.viewUrl(path);
      if (!url) throw new ApiError("NOT_FOUND", "That photo does not exist or you may not view it");
      return ok(c, { url });
    },
  );
}
