import { createMiddleware } from "hono/factory";
import { can, highestRole, type Permission } from "@reef/shared";
import { ApiError } from "../http/errors.js";
import type { AppEnv } from "../app.js";

/** Requires a valid token, then works out the caller's role once for the whole request. */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new ApiError("UNAUTHENTICATED", "Sign in to continue");

  let userId: string;
  try {
    ({ userId } = await c.var.deps.verifyToken(token));
  } catch {
    throw new ApiError("UNAUTHENTICATED", "Your session has expired or is not valid. Sign in again");
  }

  const repos = c.var.deps.repositories(token);
  const role = highestRole(await repos.roles.forUser(userId));
  c.set("user", { id: userId, role });
  c.set("repos", repos);
  await next();
});

export function requirePermission(permission: Permission) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!can(c.var.user.role, permission)) {
      throw new ApiError("FORBIDDEN", "Your role does not allow this");
    }
    await next();
  });
}
