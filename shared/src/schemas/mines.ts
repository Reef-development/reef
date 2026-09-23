import { z } from "zod";
import { Id } from "./common.js";

/** Columns a client may send. `.strict()` refuses anything else rather than silently dropping it. */
export const MineInput = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    client_id: Id.nullable().optional(),
    location: z.string().trim().max(200).nullable().optional(),
    team_name: z.string().trim().max(120).nullable().optional(),
    target_cost_per_ton: z.number().nonnegative().nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const MinePatch = MineInput.partial().strict();

export type MineInput = z.infer<typeof MineInput>;
export type MinePatch = z.infer<typeof MinePatch>;

export type Mine = {
  id: string;
  name: string;
  client_id: string | null;
  location: string | null;
  team_name: string | null;
  target_cost_per_ton: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

/** Columns a list may be sorted by. Anything else is refused, so user input never names a column. */
export const MINE_SORTABLE = ["name", "location", "created_at", "target_cost_per_ton"] as const;
