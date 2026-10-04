import type { Hono } from "hono";
import { z } from "zod";
import { SETTINGS, type SettingKey } from "@reef/shared";
import type { AppEnv } from "../app.js";
import { parseBody, parseWith } from "../http/body.js";
import { ok } from "../http/envelope.js";
import { ApiError } from "../http/errors.js";
import type { Registry } from "../registry.js";
import { defineRoute } from "./define.js";

const Key = z.enum(Object.keys(SETTINGS) as [SettingKey, ...SettingKey[]], "No such setting");

/** Platform settings the owner controls, such as how old a captured entry may be (T10). */
export function settingsRoutes(app: Hono<AppEnv>, registry: Registry) {
  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: "/api/v1/settings",
      access: "settings:read",
      summary:
        "Lists the platform settings with their current values. Every role reads them, because the capture forms need the age limit.",
      refuses: "A caller with no role.",
    },
    async (c) => ok(c, await c.var.repos.settings.list()),
  );

  defineRoute(
    app,
    registry,
    {
      method: "PATCH",
      path: "/api/v1/settings/:key",
      access: "settings:write",
      summary:
        "Changes one setting. Owner only, because a setting such as the capture age limit changes what every plant may record.",
      refuses:
        "An unknown setting, or a value outside what that setting allows (the age limit is 1 to 365 whole days).",
    },
    async (c) => {
      const key = parseWith(Key, c.req.param("key"));
      const { value } = await parseBody(c, z.object({ value: SETTINGS[key] }).strict());
      const saved = await c.var.repos.settings.set(key, value, c.var.user.id);
      if (!saved) throw new ApiError("NOT_FOUND", "That setting does not exist");
      return ok(c, saved);
    },
  );
}
