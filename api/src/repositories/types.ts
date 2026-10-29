import type {
  ReportRun,
  ReportRunReceipt,
  HistoryQuery,
  JobRun,
  ListQuery,
  Notification,
  Role,
  UserSummary,
} from "@reef/shared";
import type { Machine } from "../services/service-due.js";

export type { HistoryQuery };

export type Page<T> = { rows: T[]; total: number };

export type UpdateResult<Row> =
  { status: "updated"; row: Row } | { status: "stale"; current: Row } | { status: "missing" };

export interface Repository<Row, Input, Patch> {
  list(query: ListQuery): Promise<Page<Row>>;
  get(id: string): Promise<Row | null>;
  create(input: Input): Promise<Row>;
  update(
    id: string,
    patch: Patch,
    expectedVersion: number,
    reason: string,
  ): Promise<UpdateResult<Row>>;
  remove(id: string): Promise<boolean>;
}

export interface RoleRepository {
  forUser(userId: string): Promise<string[]>;
  plantFor(userId: string): Promise<string | null>;
}

export type Row = Record<string, unknown> & { id: string };

export interface MaintenancePartsRepository {
  forLog(logId: string): Promise<Row[]>;
  add(
    logId: string,
    part: { stock_item_id: string; qty: number; unit_cost?: number },
  ): Promise<Row>;
  remove(partId: string): Promise<boolean>;
}

export interface StockUsageRepository {
  recordUsage(stockItemId: string, qty: number): Promise<Row>;
}

export interface ReorderRequestRepository {
  listOpen(): Promise<Row[]>;
  convert(id: string): Promise<Row>;
}

export interface PhotoStore {
  uploadUrl(path: string): Promise<{ signedUrl: string; token: string }>;
  viewUrl(path: string): Promise<string | null>;
}

export type UserSession = {
  id: string;
  user_id: string;
  session_id: string;
  device: string | null;
  address: string | null;
  last_used_at: string;
  revoked_at: string | null;
  created_at: string;
};

export interface SessionRepository {
  touch(sessionId: string, device: string | null, address: string | null): Promise<boolean>;
  forUser(userId: string): Promise<UserSession[]>;
  revoke(sessionId: string): Promise<boolean>;
  revokeAll(userId: string): Promise<number>;
}

export type HistoryEntry = {
  id: string;
  table_name: string;
  row_id: string;
  changed_by: string;
  changed_at: string;
  reason: string;
  plant: string | null;
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  version: number;
};

export interface HistoryRepository {
  list(query: HistoryQuery): Promise<Page<HistoryEntry>>;
}

export interface UserRepository {
  list(): Promise<UserSummary[]>;
  setRole(userId: string, role: Role, reason: string): Promise<UserSummary | null>;
}

export type UserContext = {
  role: string;
  plant: string | null;
};

export interface ScopedRepository<Row, Input, Patch> {
  list(query: ListQuery, user: UserContext): Promise<Page<Row>>;
  get(id: string, user: UserContext): Promise<Row | null>;
  create(input: Input, user: UserContext): Promise<Row>;
  update(
    id: string,
    patch: Patch,
    expectedVersion: number,
    user: UserContext,
    reason: string,
  ): Promise<UpdateResult<Row>>;
  remove(id: string, user: UserContext): Promise<boolean>;
}

export type Period = { from: string; to: string };

export type ProductionTotals = {
  tons: number;
  magnetiteCost: number;
  overtimeCost: number;
  days: number;
};

export interface AnalyticsRepository {
  mines(): Promise<{ id: string; name: string }[]>;
  productionTotals(mineId: string, period: Period): Promise<ProductionTotals>;
  productionByDay(mineId: string, period: Period): Promise<{ date: string; tons: number }[]>;
  fixedCosts(mineId: string, period: Period): Promise<number>;
  maintenanceCost(mineId: string, period: Period): Promise<number>;
  fuelCost(mineId: string, period: Period): Promise<number>;
  downtimeHours(mineId: string, period: Period): Promise<{ reason: string; hours: number }[]>;
}

export type Leaver = {
  id: string;
  full_name: string;
  employee_no: string | null;
  left_on: string;
  id_number_held: boolean;
};

export interface RetentionRepository {
  leavers(): Promise<Leaver[]>;
}

export interface ServiceSweepRepository {
  machines(): Promise<Machine[]>;
  recipients(mineId: string | null): Promise<string[]>;
  raise(rows: readonly NotificationDraft[]): Promise<number>;
}

export type NotificationDraft = {
  user_id: string;
  kind: "service_due";
  subject: string;
  body: string;
  equipment_id: string | null;
  mine_id: string | null;
  dedupe_key: string;
};

export interface JobRepository {
  claim(job: string, ranFor: string): Promise<boolean>;
  finish(job: string, ranFor: string, outcome: string, detail: string): Promise<void>;
  runs(job: string, from: string, to: string): Promise<JobRun[]>;
}

export interface NotificationRepository {
  list(userId: string, opts: { unread?: boolean; limit: number }): Promise<Notification[]>;
  markRead(userId: string, id: string): Promise<boolean>;
}

export type Setting = {
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string;
};

export interface SettingsRepository {
  list(): Promise<Setting[]>;
  captureMaxAgeDays(): Promise<number>;
  set(key: string, value: unknown, by: string): Promise<Setting | null>;
}

export interface ReportRunRepository {
  record(mineId: string, month: string): Promise<ReportRunReceipt>;
  list(mineId?: string): Promise<ReportRun[]>;
}

/**
 * Worker purchase claims: money a worker spent out of pocket that REEF reimburses.
 *
 * `list` is scoped by RLS on the table, so this file never adds its own role
 * filter. `summary` totals whatever the caller can see, for the dashboard tile.
 * `markPaid` takes a batch so a month-end payout is one transaction.
 */
export type WorkerPurchaseFilters = {
  status?: "pending" | "paid" | "voided";
  worker_id?: string;
  mine_id?: string;
  /** "YYYY-MM". Filters by the claim's date field. */
  month?: string;
};

export interface WorkerPurchasesRepository {
  list(query: ListQuery, filters: WorkerPurchaseFilters): Promise<Page<Row>>;
  summary(): Promise<{
    pending_count: number;
    pending_total: number;
    paid_this_month_count: number;
    paid_this_month_total: number;
  }>;
  create(input: unknown, loggedBy: string): Promise<Row>;
  setStatus(
    id: string,
    change: { status: "paid" | "voided"; reason?: string | null },
    actorId: string,
  ): Promise<Row | null>;
  markPaid(ids: string[], actorId: string): Promise<{ paid: number }>;
}