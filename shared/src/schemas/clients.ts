import { z } from "zod";
import { versioned } from "./common.js";

/**
 * A client is the company that contracts REEF to operate at one or more of its mines.
 * Clients are not scoped to a plant: the contract sits at the client, and the mines a
 * client owns are the units that vary. The endpoint therefore uses the plain Repository.
 *
 * `contract_revenue_monthly` is commercially sensitive. The permission table keeps the
 * client list to owners and managers, which matches the RLS policies on the table.
 */
export const ClientInput = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    contact_name: z.string().trim().max(120).nullable().optional(),
    contact_email: z
      .string()
      .trim()
      .email("Enter a valid email address")
      .max(200)
      .nullable()
      .optional(),
    contact_phone: z.string().trim().max(40).nullable().optional(),
    contract_start: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the form YYYY-MM-DD")
      .nullable()
      .optional(),
    contract_end: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the form YYYY-MM-DD")
      .nullable()
      .optional(),
    contract_revenue_monthly: z.number().nonnegative().nullable().optional(),
    active: z.boolean().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const ClientPatch = ClientInput.partial().strict();
export const ClientUpdate = versioned(ClientPatch);

export type ClientInput = z.infer<typeof ClientInput>;
export type ClientPatch = z.infer<typeof ClientPatch>;
export type ClientUpdate = z.infer<typeof ClientUpdate>;

export type Client = {
  id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contract_start: string | null;
  contract_end: string | null;
  contract_revenue_monthly: number | null;
  active: boolean;
  notes: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export const CLIENT_SORTABLE = ["name", "contract_start", "active", "created_at"] as const;
