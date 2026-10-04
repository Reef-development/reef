import { createClient } from "@supabase/supabase-js";
import type { Config } from "../config.js";
import type { Repositories } from "../repositories/index.js";
import { SupabasePurchaseActions } from "../repositories/purchase-actions.js";
import { SupabasePurchaseOrderRepository } from "../repositories/purchase-orders.js";
import { SupabaseStockLevelRepository } from "../repositories/stock-levels.js";
import { SupabaseStockRepository } from "../repositories/stock.js";
import {
  SupabaseMaintenanceParts,
  SupabaseMaintenanceRepository,
  SupabasePhotoStore,
  SupabaseRoleRepository,
  SupabaseSettings,
  SupabaseStockUsage,
  SupabaseHistoryRepository,
  SupabaseAnalyticsRepository,
  SupabaseJobRepository,
  SupabaseNotificationRepository,
  SupabaseRetentionRepository,
  SupabaseSessionRepository,
  SupabaseServiceSweepRepository,
  SupabaseTableRepository,
  SupabaseUserRepository,
} from "../repositories/supabase.js";
import type { JobRepository, ServiceSweepRepository } from "../repositories/types.js";

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
      sessions: new SupabaseSessionRepository(db),
      history: new SupabaseHistoryRepository(db),
      users: new SupabaseUserRepository(db),
      mines: new SupabaseTableRepository(db, "mines", "name"),
      production: new SupabaseTableRepository(db, "production_logs", "date"),
      fuel: new SupabaseTableRepository(db, "fuel_slips", "date"),
      maintenance: new SupabaseMaintenanceRepository(db),
      maintenanceParts: new SupabaseMaintenanceParts(db),
      stockUsage: new SupabaseStockUsage(db),
      photos: new SupabasePhotoStore(db),
      stock: new SupabaseStockRepository(db),
      stockLevels: new SupabaseStockLevelRepository(db),
      purchaseOrders: new SupabasePurchaseOrderRepository(db),
      analytics: new SupabaseAnalyticsRepository(db),
      retention: new SupabaseRetentionRepository(db),
      notifications: new SupabaseNotificationRepository(db),
      jobs: new SupabaseJobRepository(db),
      purchaseActions: new SupabasePurchaseActions(db),
      settings: new SupabaseSettings(db),
    };
  };
}

/**
 * The sweep's own connection.
 *
 * It uses the service credential rather than a caller's token, because nobody is calling: a
 * machine falling due is a date passing. That credential bypasses row-level security, so it is
 * built here, used by the scheduler only, and never reachable from a request. Null when the key
 * is not configured, which is how the scheduler knows to say it is not running.
 */
export function schedulerRepositories(
  config: Config,
): { jobs: JobRepository; sweepRepo: ServiceSweepRepository } | null {
  if (!config.serviceRoleKey) return null;
  const db = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    jobs: new SupabaseJobRepository(db),
    sweepRepo: new SupabaseServiceSweepRepository(db),
  };
}
