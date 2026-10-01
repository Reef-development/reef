import { z } from "zod";
import { Id, versioned } from "./common.js";

/** Columns a client may send. `.strict()` refuses anything else rather than silently dropping it. */
export const StockLevelInput = z
  .object({
    stock_item_id: Id,
    plant: z.string().trim().min(1, "Plant is required").max(60),
    qty_on_hand: z.number().nonnegative().optional(),
    reorder_point: z.number().nonnegative().optional(),
    reorder_qty: z.number().nonnegative().optional(),
  })
  .strict();

export const StockLevelPatch = StockLevelInput.partial().strict();
export const StockLevelUpdate = versioned(StockLevelPatch);

export type StockLevelInput = z.infer<typeof StockLevelInput>;
export type StockLevelPatch = z.infer<typeof StockLevelPatch>;
export type StockLevelUpdate = z.infer<typeof StockLevelUpdate>;

export type StockLevel = {
  id: string;
  stock_item_id: string;
  plant: string;
  qty_on_hand: number;
  reorder_point: number;
  reorder_qty: number;
  version: number;
  created_at: string;
  updated_at: string;
};

export const STOCK_LEVEL_SORTABLE = ["plant", "qty_on_hand", "created_at"] as const;
