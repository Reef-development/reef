import { z } from "zod";
import { versioned } from "./common.js";

/**
 * A supplier is a company REEF buys stock from. Suppliers are not scoped to a plant:
 * the same supplier can serve every plant, and REEF buys from the same vendors across
 * its sites. The endpoint therefore uses the plain Repository, not the scoped one.
 */
export const SupplierInput = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    contact_name: z.string().trim().max(120).nullable().optional(),
    email: z.string().trim().email("Enter a valid email address").max(200).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const SupplierPatch = SupplierInput.partial().strict();
export const SupplierUpdate = versioned(SupplierPatch);

export type SupplierInput = z.infer<typeof SupplierInput>;
export type SupplierPatch = z.infer<typeof SupplierPatch>;
export type SupplierUpdate = z.infer<typeof SupplierUpdate>;

export type Supplier = {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export const SUPPLIER_SORTABLE = ["name", "created_at"] as const;
