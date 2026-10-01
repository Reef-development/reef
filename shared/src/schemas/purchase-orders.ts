import { z } from "zod";
import { Id, versioned } from "./common.js";

/**
 * A purchase order is a management document: it commits REEF to buy from a supplier.
 * REEF said in writing that employees cannot place purchase orders; only authorised
 * management can. The plant the order is for is required, and matches the plant of the
 * caller who raised it (unless the caller is the owner, who may raise one for any plant).
 *
 * The database supplies defaults for `status` (draft) and `total_cost` (0), so both are
 * optional on the way in. The lifecycle timestamps (`approved_at`, `ordered_at`,
 * `received_at`) move the order through the status enum and are managed by the API,
 * not sent by the client.
 */
export const PurchaseOrderInput = z
  .object({
    supplier_id: Id.nullable().optional(),
    plant: z.string().trim().min(1, "Plant is required").max(60),
    status: z.enum(["draft", "approved", "ordered", "received", "cancelled"]).optional(),
    total_cost: z.number().nonnegative().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const PurchaseOrderPatch = PurchaseOrderInput.partial().strict();
export const PurchaseOrderUpdate = versioned(PurchaseOrderPatch);

export type PurchaseOrderInput = z.infer<typeof PurchaseOrderInput>;
export type PurchaseOrderPatch = z.infer<typeof PurchaseOrderPatch>;
export type PurchaseOrderUpdate = z.infer<typeof PurchaseOrderUpdate>;

export type PurchaseOrderStatus = "draft" | "approved" | "ordered" | "received" | "cancelled";

export type PurchaseOrder = {
  id: string;
  supplier_id: string | null;
  plant: string;
  status: PurchaseOrderStatus;
  total_cost: number;
  notes: string | null;
  approved_at: string | null;
  ordered_at: string | null;
  received_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export const PURCHASE_ORDER_SORTABLE = ["created_at", "status", "total_cost"] as const;
