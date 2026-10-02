import type { SupabaseClient } from "@supabase/supabase-js";
import type { Client, ClientInput, ClientPatch } from "@reef/shared";
import { SupabaseTableRepository } from "./supabase.js";

/**
 * Clients are not plant-scoped. A client is the company that contracts REEF to operate at
 * one or more of its mines; the contract sits at the client, and the mines a client owns
 * are the units that vary. There is therefore no plant filter to apply, and the repository
 * is the generic table repository with the table name and default sort filled in.
 *
 * Every other behaviour is inherited from `SupabaseTableRepository`.
 */
export class SupabaseClientRepository extends SupabaseTableRepository<
  Client,
  ClientInput,
  ClientPatch
> {
  constructor(db: SupabaseClient) {
    super(db, "clients", "name");
  }
}