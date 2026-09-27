import type { Handler, Hono } from "hono";
import type { AppEnv } from "../app.js";
import { requirePermission, requireUser } from "../auth/middleware.js";
import type { Registry, RouteInfo } from "../registry.js";

/**
 * The only way a route is added. It records the route in the registry and attaches the
 * sign-in and permission checks that its `access` names, so a route cannot be exposed without
 * its guard being applied and listed.
 */
export function defineRoute(app: Hono<AppEnv>, registry: Registry, info: RouteInfo, handler: Handler<AppEnv>) {
  registry.add(info);
  const method = info.method.toLowerCase() as "get" | "post" | "patch" | "delete";
  if (info.access === "public") {
    app[method](info.path, handler);
  } else if (info.access === "signed-in") {
    app[method](info.path, requireUser, handler);
  } else {
    app[method](info.path, requireUser, requirePermission(info.access), handler);
  }
}
