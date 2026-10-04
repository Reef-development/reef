import type { Hono } from "hono";
import { Id, NotificationQuery } from "@reef/shared";
import type { AppEnv } from "../app.js";
import { parseWith } from "../http/body.js";
import { ok } from "../http/envelope.js";
import { ApiError } from "../http/errors.js";
import type { Registry } from "../registry.js";
import { defineRoute } from "./define.js";

export function notificationRoutes(app: Hono<AppEnv>, registry: Registry) {
  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: "/api/v1/notifications",
      access: "notifications:read",
      summary:
        "The signed-in person's own notifications, newest first, with an unread filter. Today that is the service reminders the scheduled sweep raises.",
      refuses:
        "Anybody else's notifications: there is no user parameter, and the database policy limits every read to the caller's own rows even if one were added. A limit above 200.",
    },
    async (c) => {
      const q = parseWith(NotificationQuery, c.req.query());
      const rows = await c.var.repos.notifications.list(c.var.user.id, {
        unread: q.unread,
        limit: q.limit,
      });
      return ok(c, rows);
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "PATCH",
      path: "/api/v1/notifications/:id/read",
      access: "notifications:read",
      summary: "Marks one of your own notifications as read.",
      refuses:
        "A notification belonging to somebody else, and one already read, both as 404. Marking a notification read is not a change anybody needs to be warned about, so this one carries no version check.",
    },
    async (c) => {
      const id = parseWith(Id, c.req.param("id"));
      const marked = await c.var.repos.notifications.markRead(c.var.user.id, id);
      // Somebody else's notification and an already-read one answer the same way. A different
      // answer for the first would tell the caller that a notification exists.
      if (!marked) {
        throw new ApiError("NOT_FOUND", "That notification does not exist or is already read");
      }
      return ok(c, { read: true });
    },
  );
}
