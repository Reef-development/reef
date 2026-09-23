import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { Role } from "@reef/shared";
import type { TokenVerifier } from "./auth/verify.js";
import { fail } from "./http/envelope.js";
import { ApiError } from "./http/errors.js";
import { Registry } from "./registry.js";
import type { Repositories } from "./repositories/index.js";
import { registerRoutes } from "./routes/index.js";

export type Deps = {
  verifyToken: TokenVerifier;
  repositories: (token: string) => Repositories;
  corsOrigins: string[];
  log?: (msg: string, err: unknown) => void;
};

export type AppEnv = {
  Variables: {
    deps: Deps;
    user: { id: string; role: Role | null };
    repos: Repositories;
  };
};

/** Builds the app from its dependencies, so tests can run it with fakes and no network. */
export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();
  const registry = new Registry();

  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: deps.corsOrigins,
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE"],
    }),
  );
  app.use(
    "*",
    bodyLimit({
      maxSize: 100 * 1024,
      onError: (c) => fail(c, new ApiError("VALIDATION_FAILED", "Request body is too large")),
    }),
  );
  app.use("*", async (c, next) => {
    c.set("deps", deps);
    await next();
  });

  registerRoutes(app, registry);

  app.notFound((c) => fail(c, new ApiError("NOT_FOUND", "No such endpoint")));
  app.onError((err, c) => {
    if (err instanceof ApiError && err.code !== "INTERNAL") return fail(c, err);
    // Unexpected failures are logged in full but never described to the caller.
    (deps.log ?? console.error)(`${c.req.method} ${c.req.path} failed`, err);
    return fail(
      c,
      new ApiError("INTERNAL", "Something went wrong on our side. Try again, and tell the site manager if it keeps happening"),
    );
  });

  return { app, registry };
}
