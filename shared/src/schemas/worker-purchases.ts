import { z } from "zod";

/**
 * Worker purchases: money a worker spends out of pocket that REEF reimburses.
 *
 * The lifecycle is short. A worker (or a supervisor on their behalf) submits a
 * claim; it sits as `pending`. At month end the owner marks it `paid`, or voids
 * it with a reason. There is no approval step in between.
 *
 * `category` is free text on purpose. The form suggests presets, but nothing
 * in the database rejects a value the business actually uses.
 */

export const WorkerPurchaseInput = z.object({
worker_id: z.string().uuid().optional().nullable(),
  mine_id: z.string().uuid().optional().nullable(),
  stock_item_id: z.string().uuid().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(500),
  category: z.string().min(1).max(50),
  amount: z.coerce.number().positive().max(1_000_000),
  receipt_urls: z.array(z.string().min(1)).max(10).optional(),
  notes: z.string().max(1000).optional().nullable(),
});

export type WorkerPurchaseInput = z.infer<typeof WorkerPurchaseInput>;

export const WorkerPurchaseStatusChange = z.object({
  status: z.enum(["paid", "voided"]),
  reason: z.string().max(500).optional().nullable(),
});

export type WorkerPurchaseStatusChange = z.infer<typeof WorkerPurchaseStatusChange>;

export const WORKER_PURCHASE_SORTABLE = ["date", "amount", "created_at"] as const;
export type WorkerPurchaseSortable = (typeof WORKER_PURCHASE_SORTABLE)[number];