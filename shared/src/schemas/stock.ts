import { z } from "zod";
import { Id, versioned } from "./common.js";

/**
 * The catalogue entry for a part. Name, sku, unit, supplier — what a part is.
 * The quantities that belong to a specific plant (qty_on_hand, reorder_point,
 * reorder_qty) live on stock_levels, not here. A part exists once; its levels exist
 * once per plant.
 */
export const StockInput = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    sku: z.string().trim().max(60).nullable().optional(),
    unit: z.string().trim().max(20).nullable().optional(),
    plant: z.string().trim().min(1, "Plant is required").max(60),
    unit_cost: z.number().nonnegative().optional(),
    supplier_id: Id.nullable().optional(),
  })
  .strict();

/**
 * A patch cannot change the plant. A stock item's plant is set at creation and never
 * changes — moving a row between plants is not what a PATCH means. The database policy
 * and the stock_items_protect_plant trigger both refuse it as second lines of defence.
 */
export const StockPatch = StockInput.omit({ plant: true }).partial().strict();
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
  unit_cost: number;
  supplier_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

/** Columns a list may be sorted by. Anything else is refused, so user input never names a column. */
export const STOCK_SORTABLE = ["name", "plant", "created_at"] as const;
