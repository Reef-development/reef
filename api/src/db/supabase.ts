import { createClient } from "@supabase/supabase-js";
import type { Config } from "../config.js";
import type { Repositories } from "../repositories/index.js";
import type { JobRepository, ServiceSweepRepository } from "../repositories/types.js";
import {
  SupabaseAnalyticsRepository,
  SupabaseHistoryRepository,
  SupabaseJobRepository,
  SupabaseNotificationRepository,
  SupabaseRetentionRepository,
  SupabaseRoleRepository,
  SupabaseServiceSweepRepository,
  SupabaseTableRepository,
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
      analytics: new SupabaseAnalyticsRepository(db),
      retention: new SupabaseRetentionRepository(db),
      notifications: new SupabaseNotificationRepository(db),
      jobs: new SupabaseJobRepository(db),
      mines: new SupabaseTableRepository(db, "mines", "name"),
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
