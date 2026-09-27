import type { Hono } from "hono";
import type { ZodType } from "zod";
import { Id, ListQuery, type Permission } from "@reef/shared";
import type { AppEnv } from "../app.js";
import { parseBody, parseWith } from "../http/body.js";
import { ok } from "../http/envelope.js";
import { ApiError } from "../http/errors.js";
import type { Registry } from "../registry.js";
import type { Repositories } from "../repositories/index.js";
import type { Repository } from "../repositories/types.js";
import { defineRoute } from "./define.js";

type ResourceSpec = {
  /** Plural path segment, e.g. "mines". */
  name: string;
  /** Singular noun for messages, e.g. "site". */
  noun: string;
  repo: (r: Repositories) => Repository<unknown, unknown, unknown>;
  input: ZodType;
  patch: ZodType;
  sortable: readonly string[];
  read: Permission;
  write: Permission;
  summaries: { list: string; get: string; create: string; update: string; remove: string };
};

/**
 * Registers list, get, create, update and delete for one table. Most of the platform's
 * resources are plain records, so this keeps them identical in behaviour instead of sixteen
 * hand-written copies that drift apart.
 */
export function resourceRoutes(app: Hono<AppEnv>, registry: Registry, spec: ResourceSpec) {
  const base = `/api/v1/${spec.name}`;
  const notFound = () => new ApiError("NOT_FOUND", `That ${spec.noun} does not exist or has been removed`);
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
      refuses: "An unknown sort column or a page size above 200.",
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
      refuses: "An id that is not a UUID, or a record that does not exist.",
    },
    async (c) => {
      const id = parseWith(Id, c.req.param("id"));
      const row = await spec.repo(c.var.repos).get(id);
      if (!row) throw notFound();
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
      refuses: "Missing or invalid fields, and any field it does not recognise.",
    },
    async (c) => {
      const body = await parseBody(c, spec.input);
      const row = await spec.repo(c.var.repos).create(body);
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
      refuses: "Invalid or unrecognised fields, or a record that does not exist.",
    },
    async (c) => {
      const id = parseWith(Id, c.req.param("id"));
      const body = await parseBody(c, spec.patch);
      const row = await spec.repo(c.var.repos).update(id, body);
      if (!row) throw notFound();
      return ok(c, row);
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
      refuses: "A record that does not exist, or one that other records still point to.",
    },
    async (c) => {
      const id = parseWith(Id, c.req.param("id"));
      const removed = await spec.repo(c.var.repos).remove(id);
      if (!removed) throw notFound();
      return ok(c, { id, deleted: true });
    },
  );
}
