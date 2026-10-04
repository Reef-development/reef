import { createClient } from "@supabase/supabase-js";
import type { Config } from "../config.js";
import type { Repositories } from "../repositories/index.js";
import { SupabasePurchaseOrderRepository } from "../repositories/purchase-orders.js";
import { SupabaseStockLevelRepository } from "../repositories/stock-levels.js";
import { SupabaseStockRepository } from "../repositories/stock.js";
import {
  SupabaseHistoryRepository,
  SupabaseRoleRepository,
  SupabaseTableRepository,
  SupabaseUserRepository,
} from "../repositories/supabase.js";

/**
 * Builds the repositories for one request, carrying the caller's own token. The database
 * therefore sees the real user, and its row-level security still applies if an API check is
 * ever wrong.
 */
export function supabaseRepositories(config: Config) {
  return (token: string): Repositories => {
    const db = createClient(config.supabaseUrl, config.supabaseKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return {
      roles: new SupabaseRoleRepository(db),
      history: new SupabaseHistoryRepository(db),
      users: new SupabaseUserRepository(db),
      mines: new SupabaseTableRepository(db, "mines", "name"),
      stock: new SupabaseStockRepository(db),
      stockLevels: new SupabaseStockLevelRepository(db),
      purchaseOrders: new SupabasePurchaseOrderRepository(db),
    };
  };
}
