import type { SupabaseClient } from "@supabase/supabase-js";
import type { Supplier, SupplierInput, SupplierPatch } from "@reef/shared";
import { SupabaseTableRepository } from "./supabase.js";

/**
 * Suppliers are not plant-scoped. The same vendor can serve every plant, and REEF buys
 * from the same suppliers across its sites. There is therefore no plant filter to apply,
 * and the repository is the generic table repository with the table name and default
 * sort filled in.
 *
 * Every other behaviour — the version check inside the UPDATE, the history row written
 * after a successful change, the error translation — is inherited from
 * `SupabaseTableRepository`, which was extended for T6 to write history on update.
 */
export class SupabaseSupplierRepository extends SupabaseTableRepository<
  Supplier,
  SupplierInput,
  SupplierPatch
> {
  constructor(db: SupabaseClient) {
    super(db, "suppliers", "name");
  }
}