import { z } from "zod";
import { Id, versioned } from "./common.js";

/** Columns a client may send. `.strict()` refuses anything else rather than silently dropping it. */
export const StockInput = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    sku: z.string().trim().max(60).nullable().optional(),
    unit: z.string().trim().max(20).nullable().optional(),
    plant: z.string().trim().min(1, "Plant is required").max(60),
    qty_on_hand: z.number().nonnegative().optional(),
    reorder_point: z.number().nonnegative().optional(),
    reorder_qty: z.number().nonnegative().optional(),
    unit_cost: z.number().nonnegative().optional(),
    supplier_id: Id.nullable().optional(),
  })
  .strict();

export const StockPatch = StockInput.partial().strict();
export const StockUpdate = versioned(StockPatch);

export type StockInput = z.infer<typeof StockInput>;
export type StockPatch = z.infer<typeof StockPatch>;
export type StockUpdate = z.infer<typeof StockUpdate>;

export type Stock = {
  id: string;
  name: string;
  sku: string | null;
  unit: string | null;
  plant: string;
  qty_on_hand: number;
  reorder_point: number;
  reorder_qty: number;
  unit_cost: number;
  supplier_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

/** Columns a list may be sorted by. Anything else is refused, so user input never names a column. */
export const STOCK_SORTABLE = ["name", "plant", "qty_on_hand", "created_at"] as const;
