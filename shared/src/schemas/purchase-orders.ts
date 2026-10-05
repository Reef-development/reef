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

/**
 * A patch cannot change the plant. The order was raised for a plant; moving it would
 * rewrite who it belongs to. The API refuses a plant change at validation, and the
 * database refuses it again at the policy layer.
 */
export const PurchaseOrderPatch = PurchaseOrderInput.omit({ plant: true }).partial().strict();
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

/** A line on a purchase order: a part from the order's own plant, how many, and the price. */
export const PoLineInput = z
  .object({
    stock_item_id: Id,
    qty: z.number().positive("Quantity must be more than zero"),
    /** Leave out to use the part's catalogue price. */
    unit_cost: z.number().nonnegative().optional(),
  })
  .strict();
export type PoLineInput = z.infer<typeof PoLineInput>;

export type PoLine = {
  id: string;
  po_id: string;
  stock_item_id: string | null;
  qty: number;
  unit_cost: number;
};

const ActionReason = z
  .string()
  .trim()
  .min(1, "A reason is required")
  .max(500, "The reason is too long (500 characters maximum)");

/** Approving, ordering or receiving: a reason is welcome but not required. */
export const PoAction = z.object({ reason: ActionReason.optional() }).strict();
/** Cancelling: a reason is required, because a cancelled order is final. */
export const PoCancel = z.object({ reason: ActionReason }).strict();
export type PoAction = z.infer<typeof PoAction>;
