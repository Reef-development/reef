import { createMiddleware } from "hono/factory";
import { getConnInfo } from "@hono/node-server/conninfo";
import { can, highestRole, type Permission } from "@reef/shared";
import { ApiError } from "../http/errors.js";
import type { AppEnv } from "../app.js";

/** Requires a valid token, checks the session, then works out the caller's role. */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token) {
    throw new ApiError("UNAUTHENTICATED", "Sign in to continue");
  }

  let userId: string;
  let sessionId: string;

  try {
    ({ userId, sessionId } = await c.var.deps.verifyToken(token));
  } catch {
    throw new ApiError(
      "UNAUTHENTICATED",
      "Your session has expired or is not valid. Sign in again",
    );
  }

  const repos = c.var.deps.repositories(token);

  const device = c.req.header("user-agent") ?? null;

  let address: string | null = null;

  try {
    address = getConnInfo(c).remote.address ?? null;
  } catch {
    // Test requests do not always have a real network socket.
    address = null;
  }

  const sessionActive = await repos.sessions.touch(sessionId, device, address);

  if (!sessionActive) {
    throw new ApiError("UNAUTHENTICATED", "This sign-in has been revoked. Sign in again");
  }

  const role = highestRole(await repos.roles.forUser(userId));

  c.set("user", {
    id: userId,
    role,
    sessionId,
  });

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
