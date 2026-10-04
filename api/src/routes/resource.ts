import type { Hono } from "hono";
import { z } from "zod";
import { ListQuery } from "@reef/shared";
import type { AppEnv } from "../app.js";
import { parseWith } from "../http/body.js";
import { ApiError } from "../http/errors.js";
import { ok } from "../http/envelope.js";
import { type Permission } from "@reef/shared";
import type { Registry } from "../registry.js";
import type { Repositories } from "../repositories/index.js";
import type { Repository, ScopedRepository, UserContext } from "../repositories/types.js";
import { defineRoute } from "./define.js";

type Summaries = {
  list: string;
  get: string;
  create: string;
  update: string;
  remove: string;
};

type ResourceSpec<Row, Input, Patch> = {
  name: string;
  noun: string;
  repo: (repos: Repositories) => Repository<Row, Input, Patch>;
  input: z.ZodType<Input>;
  patch: z.ZodType<Patch>;
  sortable: readonly string[];
  read: Permission;
  write: Permission;
  summaries: Summaries;
};

type ScopedResourceSpec<Row, Input, Patch> = {
  name: string;
  noun: string;
  repo: (repos: Repositories) => ScopedRepository<Row, Input, Patch>;
  input: z.ZodType<Input>;
  patch: z.ZodType<Patch>;
  sortable: readonly string[];
  read: Permission;
  write: Permission;
  summaries: Summaries;
};

/** Turns a Zod issue into the shape the error envelope expects. */
function validationError(err: z.ZodError): ApiError {
  return new ApiError("VALIDATION_FAILED", "One or more fields are invalid", err.issues);
}

/** A single-field validation error in the same shape Zod uses. */
function fieldError(field: string, message: string): ApiError {
  return new ApiError("VALIDATION_FAILED", message, [{ path: field, message }]);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireId(c: { req: { param: (n: string) => string | undefined } }): string {
  const id = c.req.param("id");
  if (!id) {
    throw fieldError("id", "An id is required");
  }
  if (!UUID_RE.test(id)) {
    throw fieldError("id", "The id must be a UUID");
  }
  return id;
}

async function readBody(c: {
  req: { json: () => Promise<unknown> };
}): Promise<Record<string, unknown>> {
  try {
    const parsed = await c.req.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ApiError("VALIDATION_FAILED", "The body must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("VALIDATION_FAILED", "The body is not valid JSON");
  }
}

/** Lists, reads, creates, updates and removes one resource, with permission checks. */
export function resourceRoutes<Row extends { id: string; version: number }, Input, Patch>(
  app: Hono<AppEnv>,
  registry: Registry,
  spec: ResourceSpec<Row, Input, Patch>,
) {
  const base = `/api/v1/${spec.name}`;
  const Query = ListQuery.refine((q) => !q.sort || spec.sortable.includes(q.sort), {
    message: `Sort by one of: ${spec.sortable.join(", ")}`,
    path: ["sort"],
  });

  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: base,
      access: spec.read,
      summary: spec.summaries.list,
    },
    async (c) => {
      const q = parseWith(Query, c.req.query());
      const { rows, total } = await spec.repo(c.var.repos).list(q);
      return ok(c, rows, 200, { page: q.page, pageSize: q.pageSize, total });
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: `${base}/:id`,
      access: spec.read,
      summary: spec.summaries.get,
    },
    async (c) => {
      const id = requireId(c);
      const row = await spec.repo(c.var.repos).get(id);
      if (!row) {
        throw new ApiError("NOT_FOUND", `That ${spec.noun} does not exist or has been removed`);
      }
      return ok(c, row);
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "POST",
      path: base,
      access: spec.write,
      summary: spec.summaries.create,
    },
    async (c) => {
      const body = await readBody(c);
      const parsed = spec.input.safeParse(body);
      if (!parsed.success) throw validationError(parsed.error);
      const row = await spec.repo(c.var.repos).create(parsed.data);
      return ok(c, row, 201);
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "PATCH",
      path: `${base}/:id`,
      access: spec.write,
      summary: spec.summaries.update,
    },
    async (c) => {
      const id = requireId(c);
      const body = await readBody(c);
      const version = body.version;
      const reason = body.reason;
      delete body.version;
      delete body.reason;

      if (typeof version !== "number") {
        throw fieldError("version", "A version is required to change a record");
      }
      if (typeof reason !== "string" || reason.trim() === "") {
        throw fieldError("reason", "A reason is required when changing a record");
      }

      const parsed = spec.patch.safeParse(body);
      if (!parsed.success) throw validationError(parsed.error);

      const result = await spec.repo(c.var.repos).update(id, parsed.data, version, reason);

      if (result.status === "missing") {
        throw new ApiError("NOT_FOUND", `That ${spec.noun} does not exist or has been removed`);
      }
      if (result.status === "stale") {
        throw new ApiError(
          "CONFLICT",
          `Someone else changed this ${spec.noun} since you opened it`,
          { current: result.current },
        );
      }
      return ok(c, result.row);
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "DELETE",
      path: `${base}/:id`,
      access: spec.write,
      summary: spec.summaries.remove,
    },
    async (c) => {
      const id = requireId(c);
      const removed = await spec.repo(c.var.repos).remove(id);
      if (!removed) {
        throw new ApiError("NOT_FOUND", `That ${spec.noun} does not exist or has been removed`);
      }
      return ok(c, { removed: true });
    },
  );
}

/**
 * Same as `resourceRoutes`, but every request carries the caller into the repository, so
 * the repository can enforce its own scoping. Used by the plant-scoped resources: stock,
 * stock levels and purchase orders.
 */
export function scopedResourceRoutes<Row extends { id: string; version: number }, Input, Patch>(
  app: Hono<AppEnv>,
  registry: Registry,
  spec: ScopedResourceSpec<Row, Input, Patch>,
) {
  const base = `/api/v1/${spec.name}`;
  const Query = ListQuery.refine((q) => !q.sort || spec.sortable.includes(q.sort), {
    message: `Sort by one of: ${spec.sortable.join(", ")}`,
    path: ["sort"],
  });

  const caller = (c: { var: AppEnv["Variables"] }): UserContext => ({
    role: c.var.user.role ?? "",
    plant: c.var.user.plant,
  });

  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: base,
      access: spec.read,
      summary: spec.summaries.list,
    },
    async (c) => {
      const q = parseWith(Query, c.req.query());
      const { rows, total } = await spec.repo(c.var.repos).list(q, caller(c));
      return ok(c, rows, 200, { page: q.page, pageSize: q.pageSize, total });
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: `${base}/:id`,
      access: spec.read,
      summary: spec.summaries.get,
    },
    async (c) => {
      const id = requireId(c);
      const row = await spec.repo(c.var.repos).get(id, caller(c));
      if (!row) {
        throw new ApiError("NOT_FOUND", `That ${spec.noun} does not exist or has been removed`);
      }
      return ok(c, row);
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "POST",
      path: base,
      access: spec.write,
      summary: spec.summaries.create,
    },
    async (c) => {
      const body = await readBody(c);
      const parsed = spec.input.safeParse(body);
      if (!parsed.success) throw validationError(parsed.error);
      const row = await spec.repo(c.var.repos).create(parsed.data, caller(c));
      return ok(c, row, 201);
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "PATCH",
      path: `${base}/:id`,
      access: spec.write,
      summary: spec.summaries.update,
    },
    async (c) => {
      const id = requireId(c);
      const body = await readBody(c);
      const version = body.version;
      const reason = body.reason;
      delete body.version;
      delete body.reason;

      if (typeof version !== "number") {
        throw fieldError("version", "A version is required to change a record");
      }
      if (typeof reason !== "string" || reason.trim() === "") {
        throw fieldError("reason", "A reason is required when changing a record");
      }

      const parsed = spec.patch.safeParse(body);
      if (!parsed.success) throw validationError(parsed.error);

      const result = await spec.repo(c.var.repos).update(id, parsed.data, version, caller(c));

      if (result.status === "missing") {
        throw new ApiError("NOT_FOUND", `That ${spec.noun} does not exist or has been removed`);
      }
      if (result.status === "stale") {
        throw new ApiError(
          "CONFLICT",
          `Someone else changed this ${spec.noun} since you opened it`,
          { current: result.current },
        );
      }
      return ok(c, result.row);
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "DELETE",
      path: `${base}/:id`,
      access: spec.write,
      summary: spec.summaries.remove,
    },
    async (c) => {
      const id = requireId(c);
      const removed = await spec.repo(c.var.repos).remove(id, caller(c));
      if (!removed) {
        throw new ApiError("NOT_FOUND", `That ${spec.noun} does not exist or has been removed`);
      }
      return ok(c, { removed: true });
    },
  );
}
