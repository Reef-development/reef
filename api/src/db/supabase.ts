import { createClient } from "@supabase/supabase-js";
import type { Config } from "../config.js";
import type { Repositories } from "../repositories/index.js";
import { SupabaseClientRepository } from "../repositories/clients.js";
import { SupabaseSupplierRepository } from "../repositories/suppliers.js";
import {
  SupabaseHistoryRepository,
  SupabaseRoleRepository,
  SupabaseTableRepository,
} from "../repositories/supabase.js";

export function supabaseRepositories(config: Config) {
  return (token: string): Repositories => {
    const db = createClient(config.supabaseUrl, config.supabaseKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return {
      roles: new SupabaseRoleRepository(db),
      history: new SupabaseHistoryRepository(db),
      mines: new SupabaseTableRepository(db, "mines", "name"),
      suppliers: new SupabaseSupplierRepository(db),
      clients: new SupabaseClientRepository(db),
    };
  };
}