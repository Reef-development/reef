import type { Hono } from "hono";
import { z } from "zod";
import {
  Id,
  ListQuery,
  WorkerPurchaseInput,
  WorkerPurchaseStatusChange,
  WORKER_PURCHASE_SORTABLE,
} from "@reef/shared";
import type { AppEnv } from "../app.js";
import { parseBody, parseWith } from "../http/body.js";
import { ok } from "../http/envelope.js";
import { ApiError } from "../http/errors.js";
import type { Registry } from "../registry.js";
import { defineRoute } from "./define.js";

const List = ListQuery.refine(
  (q) => !q.sort || (WORKER_PURCHASE_SORTABLE as readonly string[]).includes(q.sort),
  {
    message: `Sort by one of: ${WORKER_PURCHASE_SORTABLE.join(", ")}`,
    path: ["sort"],
  },
);

const Filters = z.object({
  status: z.enum(["pending", "paid", "voided"]).optional(),
  worker_id: z.string().uuid().optional(),
  mine_id: z.string().uuid().optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});

const MarkPaidBody = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * Worker purchases: money a worker spends out of pocket that REEF reimburses.
 *
 * Reads are scoped by RLS on the worker_purchases table, so the list route never
 * filters by role itself — the database is the authority. Insert is open to any
 * signed-in user so a supervisor can record a claim on someone's behalf.
 */
export function workerPurchasesRoutes(app: Hono<AppEnv>, registry: Registry) {
  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: "/api/v1/worker-purchases",
      access: "signed-in",
      summary:
        "Lists worker purchase claims the caller can see. A worker sees their own, a manager sees their plant, an owner sees everything. Filter by status, worker, mine, or month.",
      refuses: "An unknown sort column, an unknown status filter, or a page size above 200.",
    },
    async (c) => {
      const q = parseWith(List, c.req.query());
      const f = parseWith(Filters, c.req.query());
      const { rows, total } = await c.var.repos.workerPurchases.list(q, f);
      return ok(c, rows, 200, { page: q.page, pageSize: q.pageSize, total });
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: "/api/v1/worker-purchases/summary",
      access: "signed-in",
      summary:
        "Totals the caller can see: outstanding pending claims and claims paid this month. For the dashboard tile.",
      refuses: "Nobody signed in.",
    },
    async (c) => ok(c, await c.var.repos.workerPurchases.summary()),
  );

  defineRoute(
    app,
    registry,
    {
      method: "POST",
      path: "/api/v1/worker-purchases",
      access: "signed-in",
      summary:
        "Records a purchase a worker paid for out of pocket. A worker submits for themselves; a supervisor may submit on someone else's behalf. Amount must be positive and the date cannot be in the future.",
      refuses:
        "A missing worker, description, category or amount; a zero or negative amount; a date in the future; a worker id that is not a UUID.",
    },
    async (c) => {
      const body = await parseBody(c, WorkerPurchaseInput);
      const row = await c.var.repos.workerPurchases.create(body, c.var.user.id);
      return ok(c, row, 201);
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "PATCH",
      path: "/api/v1/worker-purchases/:id/status",
      access: "po:write",
      summary:
        "Marks one claim paid, or voids it with a reason. The owner's action at month end. Paid sets paid_on and paid_by; voided requires a reason.",
      refuses:
        "A claim that does not exist; a status other than paid or voided; a void with no reason; a caller who is not an owner.",
    },
    async (c) => {
      const id = parseWith(Id, c.req.param("id"));
      const body = await parseBody(c, WorkerPurchaseStatusChange);
      if (body.status === "voided" && !body.reason?.trim()) {
        throw new ApiError("VALIDATION_FAILED", "A reason is required to void a claim");
      }
      const row = await c.var.repos.workerPurchases.setStatus(id, body, c.var.user.id);
      if (!row)
        throw new ApiError("NOT_FOUND", "That claim does not exist or you may not change it");
      return ok(c, row);
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "POST",
      path: "/api/v1/worker-purchases/mark-paid",
      access: "po:write",
      summary:
        "Marks a batch of claims paid in one call. The confirmation dialog uses this so a month-end payout is one transaction, not ten.",
      refuses:
        "An empty list; any id in the list that does not exist or is not a pending claim; a caller who is not an owner.",
    },
    async (c) => {
      const body = await parseBody(c, MarkPaidBody);
      const result = await c.var.repos.workerPurchases.markPaid(body.ids, c.var.user.id);
      return ok(c, result);
    },
  );
}