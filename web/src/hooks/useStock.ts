import { useQuery } from "@tanstack/react-query";
import { apiListAll } from "@/lib/api";

/** A part from the catalogue (T14): what it is, and which plant it belongs to. */
export type StockItem = {
  id: string;
  name: string;
  sku: string | null;
  unit: string | null;
  plant: string;
  unit_cost: number;
  supplier_id: string | null;
  version: number;
};

/** A plant's level for a part (T14): how many are on hand and when to reorder. */
export type StockLevel = {
  id: string;
  stock_item_id: string;
  plant: string;
  qty_on_hand: number;
  reorder_point: number;
  reorder_qty: number;
  version: number;
};

/** A part with its level at its own plant, as the stock screens show it. */
export type StockOnHand = StockItem & {
  qty_on_hand: number;
  reorder_point: number;
  reorder_qty: number;
  /** The level row, for saving changes to the quantities. Null if none exists yet. */
  level: StockLevel | null;
};

/** One query key for everything stock, so a change anywhere refreshes every stock figure. */
export const STOCK_KEY = ["stock"] as const;

/**
 * Every part the API lets the signed-in person see, with its level. The API decides which
 * plants those are: a manager or worker gets their own plant, the owner gets every plant.
 * Nothing here filters by plant, so a screen can never show more, or less, than the API allows.
 */
export function useStockOnHand() {
  return useQuery({
    queryKey: [...STOCK_KEY, "on-hand"],
    queryFn: async (): Promise<StockOnHand[]> => {
      const [items, levels] = await Promise.all([
        apiListAll<StockItem>("/api/v1/stock", { sort: "name", order: "asc" }),
        apiListAll<StockLevel>("/api/v1/stock-levels"),
      ]);
      return items.map((item) => {
        const level =
          levels.find((l) => l.stock_item_id === item.id && l.plant === item.plant) ?? null;
        return {
          ...item,
          qty_on_hand: Number(level?.qty_on_hand ?? 0),
          reorder_point: Number(level?.reorder_point ?? 0),
          reorder_qty: Number(level?.reorder_qty ?? 0),
          level,
        };
      });
    },
  });
}

export const isLow = (s: Pick<StockOnHand, "qty_on_hand" | "reorder_point">) =>
  s.qty_on_hand <= s.reorder_point;
