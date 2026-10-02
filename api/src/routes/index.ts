import type { Hono } from "hono";
import { z } from "zod";
import { MINE_SORTABLE, MineInput, MinePatch } from "@reef/shared";
import type { AppEnv } from "../app.js";
import { ok } from "../http/envelope.js";
import type { Registry } from "../registry.js";
import { defineRoute } from "./define.js";
import { resourceRoutes } from "./resource.js";

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
        "Returns the signed-in user's id and role, so the web app can choose which screens to show.",
      refuses: "A missing, expired or foreign token.",
    },
    (c) =>
  ok(c, {
    id: c.var.user.id,
    role: c.var.user.role,
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
      const userId = UserId.parse(c.req.param("userId"));

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
      const sessionId = SessionId.parse(c.req.param("sessionId"));

      const revoked = await c.var.repos.sessions.revoke(sessionId);

      if (!revoked) {
        return c.json(
          {
            ok: false,
            error: {
              code: "NOT_FOUND",
              message: "That sign-in does not exist or has already been revoked",
            },
          },
          404,
        );
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
      const userId = UserId.parse(c.req.param("userId"));

      const revokedCount = await c.var.repos.sessions.revokeAll(userId);

      return ok(c, {
        userId,
        revokedCount,
      });
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