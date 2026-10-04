import { randomUUID } from "node:crypto";
import type {
  HistoryQuery,
  JobRun,
  ListQuery,
  Mine,
  MineInput,
  MinePatch,
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderPatch,
  Stock,
  StockInput,
  StockLevel,
  StockLevelInput,
  StockLevelPatch,
  StockPatch,
  Notification,
} from "@reef/shared";
import type { Machine } from "../src/services/service-due.js";
import { createApp } from "../src/app.js";
import { ApiError } from "../src/http/errors.js";
import type { Repositories } from "../src/repositories/index.js";
import type {
  AnalyticsRepository,
  HistoryEntry,
  HistoryRepository,
  JobRepository,
  Leaver,
  MaintenancePartsRepository,
  NotificationDraft,
  NotificationRepository,
  Page,
  Period,
  PhotoStore,
  ProductionTotals,
  Repository,
  RetentionRepository,
  Row,
  ScopedRepository,
  ServiceSweepRepository,
  SessionRepository,
  Setting,
  SettingsRepository,
  StockUsageRepository,
  UpdateResult,
  UserContext,
  UserSession,
} from "../src/repositories/types.js";

/** Yields to other pending requests, so overlapping calls in a test really do interleave. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Token → user, their session, roles and plant (null for the owner, who sees every plant). */
export const USERS: Record<
  string,
  { id: string; sessionId: string; roles: string[]; plant: string | null }
> = {
  "owner-token": {
    id: "00000000-0000-4000-8000-000000000001",
    sessionId: "10000000-0000-4000-8000-000000000001",
    roles: ["owner"],
    plant: null,
  },
  "manager-token": {
    id: "00000000-0000-4000-8000-000000000002",
    sessionId: "10000000-0000-4000-8000-000000000002",
    roles: ["manager"],
    plant: "A",
  },
  "worker-token": {
    id: "00000000-0000-4000-8000-000000000003",
    sessionId: "10000000-0000-4000-8000-000000000003",
    roles: ["worker"],
    plant: "A",
  },
  "no-plant-token": {
    id: "00000000-0000-4000-8000-000000000005",
    sessionId: "10000000-0000-4000-8000-000000000005",
    roles: ["manager"],
    plant: null,
  },
  "legacy-token": {
    id: "00000000-0000-4000-8000-000000000004",
    sessionId: "10000000-0000-4000-8000-000000000004",
    roles: ["stock_controller"],
    plant: "A",
  },
};

type AnyRow = { id: string; version: number } & Record<string, unknown>;

/**
 * The in-memory stand-in for the history table. Rows are appended, never updated or
 * deleted. Tests read it to assert a change was recorded.
 */
export class MemoryHistory implements HistoryRepository {
  rows: HistoryEntry[] = [];

  async list(q: HistoryQuery): Promise<Page<HistoryEntry>> {
    const matching = this.rows
      .filter((r) => (!q.table || r.table_name === q.table) && (!q.row_id || r.row_id === q.row_id))
      .reverse();
    const from = (q.page - 1) * q.pageSize;
    return { rows: matching.slice(from, from + q.pageSize), total: matching.length };
  }

  append(entry: Omit<HistoryEntry, "id" | "changed_at">): HistoryEntry {
    const full: HistoryEntry = {
      id: randomUUID(),
      changed_at: new Date().toISOString(),
      ...entry,
    };
    this.rows.push(full);
    return full;
  }
}

/**
 * The columns that differ between `before` and `after`, leaving out version and updated_at,
 * which change on every save. Mirrors the diff in the database trigger.
 */
function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const old: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (key === "version" || key === "updated_at") continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      old[key] = before[key];
      next[key] = after[key];
    }
  }
  return { old, next };
}

/** Where a table records its changes, standing in for the history trigger (T6). */
type Audit = { table: string; history: MemoryHistory; actor: () => string | null };

/**
 * An in-memory table that behaves like the database where the routes can tell the difference:
 * versions rise on update, the version check and the write happen together, and `derive` stands
 * in for the triggers that work out totals. The SQL itself is tested in test/db.
 */
export class MemoryTable<R extends AnyRow> implements Repository<R, object, object> {
  rows: R[] = [];
  audit?: Audit;

  constructor(
    private readonly defaults: Partial<R> = {},
    private readonly derive: (row: R) => void = () => {},
  ) {}

  async list(q: ListQuery): Promise<Page<R>> {
    await tick();
    const key = (q.sort ?? "created_at") as keyof R;
    const sorted = [...this.rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
    if (q.order === "desc") sorted.reverse();
    const from = (q.page - 1) * q.pageSize;
    return { rows: sorted.slice(from, from + q.pageSize), total: this.rows.length };
  }
  async get(id: string) {
    await tick();
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async create(input: object) {
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      version: 1,
      created_at: now,
      updated_at: now,
      ...this.defaults,
      ...input,
    } as unknown as R;
    this.derive(row);
    this.rows.push(row);
    return { ...row };
  }
  /**
   * Like the database: the version check and the write happen together, with no await between.
   * A missing reason is refused, as update_versioned refuses it, so a fake cannot hide that bug.
   */
  async update(
    id: string,
    patch: object,
    expectedVersion: number,
    reason: string,
  ): Promise<UpdateResult<R>> {
    await tick();
    if (!reason || reason.trim() === "") {
      throw new ApiError("VALIDATION_FAILED", "A reason is required when changing a record");
    }
    const row = this.rows.find((r) => r.id === id);
    if (!row) return { status: "missing" };
    if (row.version !== expectedVersion) return { status: "stale", current: { ...row } };
    const before = { ...row };
    Object.assign(row, patch, { version: row.version + 1, updated_at: new Date().toISOString() });
    this.derive(row);
    if (this.audit) {
      const { old, next } = diff(before, row);
      if (Object.keys(next).length > 0) {
        this.audit.history.append({
          table_name: this.audit.table,
          row_id: id,
          changed_by: this.audit.actor() ?? "00000000-0000-0000-0000-000000000000",
          reason: reason.trim(),
          plant: typeof row.plant === "string" ? row.plant : null,
          old_values: old,
          new_values: next,
          version: row.version,
        });
      }
    }
    return { status: "updated", row: { ...row } };
  }
  async remove(id: string) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.id !== id);
    return this.rows.length < before;
  }
}

export class MemoryMines extends MemoryTable<Mine & AnyRow> {
  constructor() {
    super({
      client_id: null,
      location: null,
      team_name: null,
      target_cost_per_ton: null,
      active: true,
    });
  }
}

function plantForCreate(input: { plant: string }, user: UserContext): string {
  if (user.role === "owner") return input.plant;
  if (!user.plant) {
    throw new ApiError(
      "FORBIDDEN",
      "You do not have a plant assigned, so you cannot create this record",
    );
  }
  return user.plant;
}

class MemorySessions implements SessionRepository {
  constructor(
    private readonly userId: string,
    private readonly rows: UserSession[],
  ) {}

  async touch(sessionId: string, device: string | null, address: string | null): Promise<boolean> {
    const existing = this.rows.find((row) => row.session_id === sessionId);

    if (existing) {
      if (existing.revoked_at) {
        return false;
      }

      existing.device = device;
      existing.address = address;
      existing.last_used_at = new Date().toISOString();

      return true;
    }

    const now = new Date().toISOString();

    this.rows.push({
      id: randomUUID(),
      user_id: this.userId,
      session_id: sessionId,
      device,
      address,
      last_used_at: now,
      revoked_at: null,
      created_at: now,
    });

    return true;
  }

  async forUser(userId: string): Promise<UserSession[]> {
    return this.rows
      .filter((row) => row.user_id === userId)
      .sort((a, b) => b.last_used_at.localeCompare(a.last_used_at));
  }

  async revoke(sessionId: string): Promise<boolean> {
    const session = this.rows.find(
      (row) => row.session_id === sessionId && row.revoked_at === null,
    );

    if (!session) {
      return false;
    }

    session.revoked_at = new Date().toISOString();

    return true;
  }

  async revokeAll(userId: string): Promise<number> {
    let count = 0;
    const now = new Date().toISOString();

    for (const session of this.rows) {
      if (session.user_id === userId && session.revoked_at === null) {
        session.revoked_at = now;
        count += 1;
      }
    }

    return count;
  }
}

export class MemoryStock implements ScopedRepository<Stock, StockInput, StockPatch> {
  rows: Stock[] = [];

  async list(q: ListQuery, user: UserContext): Promise<Page<Stock>> {
    await tick();
    const visible =
      user.role === "owner" ? this.rows : this.rows.filter((r) => r.plant === user.plant);
    const key = (q.sort ?? "name") as keyof Stock;
    const sorted = [...visible].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
    if (q.order === "desc") sorted.reverse();
    const from = (q.page - 1) * q.pageSize;
    return { rows: sorted.slice(from, from + q.pageSize), total: visible.length };
  }
  async get(id: string, user: UserContext): Promise<Stock | null> {
    await tick();
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    if (user.role !== "owner" && row.plant !== user.plant) return null;
    return { ...row };
  }
  async create(input: StockInput, user: UserContext): Promise<Stock> {
    const now = new Date().toISOString();
    const plant = plantForCreate(input, user);
    const row: Stock = {
      id: randomUUID(),
      sku: null,
      unit: null,
      unit_cost: 0,
      supplier_id: null,
      version: 1,
      created_at: now,
      updated_at: now,
      ...input,
      plant,
    };
    this.rows.push(row);
    return row;
  }
  async update(
    id: string,
    patch: StockPatch,
    expectedVersion: number,
    user: UserContext,
    reason: string,
  ): Promise<UpdateResult<Stock>> {
    await tick();
    if (!reason || reason.trim() === "") {
      throw new ApiError("VALIDATION_FAILED", "A reason is required when changing a record");
    }
    const row = this.rows.find((r) => r.id === id);
    if (!row) return { status: "missing" };
    if (user.role !== "owner" && row.plant !== user.plant) return { status: "missing" };
    if (row.version !== expectedVersion) return { status: "stale", current: { ...row } };
    Object.assign(row, patch, { version: row.version + 1, updated_at: new Date().toISOString() });
    return { status: "updated", row: { ...row } };
  }
  async remove(id: string, user: UserContext): Promise<boolean> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return false;
    if (user.role !== "owner" && row.plant !== user.plant) return false;
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.id !== id);
    return this.rows.length < before;
  }
}

export class MemoryStockLevel implements ScopedRepository<
  StockLevel,
  StockLevelInput,
  StockLevelPatch
> {
  rows: StockLevel[] = [];

  async list(q: ListQuery, user: UserContext): Promise<Page<StockLevel>> {
    await tick();
    const visible =
      user.role === "owner" ? this.rows : this.rows.filter((r) => r.plant === user.plant);
    const key = (q.sort ?? "created_at") as keyof StockLevel;
    const sorted = [...visible].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      return String(av).localeCompare(String(bv));
    });
    if (q.order === "desc") sorted.reverse();
    const from = (q.page - 1) * q.pageSize;
    return { rows: sorted.slice(from, from + q.pageSize), total: visible.length };
  }
  async get(id: string, user: UserContext): Promise<StockLevel | null> {
    await tick();
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    if (user.role !== "owner" && row.plant !== user.plant) return null;
    return { ...row };
  }
  async create(input: StockLevelInput, user: UserContext): Promise<StockLevel> {
    const now = new Date().toISOString();
    const plant = plantForCreate(input, user);
    const row: StockLevel = {
      id: randomUUID(),
      qty_on_hand: 0,
      reorder_point: 0,
      reorder_qty: 0,
      version: 1,
      created_at: now,
      updated_at: now,
      ...input,
      plant,
    };
    this.rows.push(row);
    return row;
  }
  async update(
    id: string,
    patch: StockLevelPatch,
    expectedVersion: number,
    user: UserContext,
    reason: string,
  ): Promise<UpdateResult<StockLevel>> {
    await tick();
    if (!reason || reason.trim() === "") {
      throw new ApiError("VALIDATION_FAILED", "A reason is required when changing a record");
    }
    const row = this.rows.find((r) => r.id === id);
    if (!row) return { status: "missing" };
    if (user.role !== "owner" && row.plant !== user.plant) return { status: "missing" };
    if (row.version !== expectedVersion) return { status: "stale", current: { ...row } };
    Object.assign(row, patch, { version: row.version + 1, updated_at: new Date().toISOString() });
    return { status: "updated", row: { ...row } };
  }
  async remove(id: string, user: UserContext): Promise<boolean> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return false;
    if (user.role !== "owner" && row.plant !== user.plant) return false;
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.id !== id);
    return this.rows.length < before;
  }
}

export class MemoryPurchaseOrder implements ScopedRepository<
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderPatch
> {
  rows: PurchaseOrder[] = [];

  async list(q: ListQuery, user: UserContext): Promise<Page<PurchaseOrder>> {
    await tick();
    const visible =
      user.role === "owner" ? this.rows : this.rows.filter((r) => r.plant === user.plant);
    const key = (q.sort ?? "created_at") as keyof PurchaseOrder;
    const sorted = [...visible].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      return String(av).localeCompare(String(bv));
    });
    if (q.order === "desc") sorted.reverse();
    const from = (q.page - 1) * q.pageSize;
    return { rows: sorted.slice(from, from + q.pageSize), total: visible.length };
  }
  async get(id: string, user: UserContext): Promise<PurchaseOrder | null> {
    await tick();
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    if (user.role !== "owner" && row.plant !== user.plant) return null;
    return { ...row };
  }
  async create(input: PurchaseOrderInput, user: UserContext): Promise<PurchaseOrder> {
    const now = new Date().toISOString();
    const plant = plantForCreate(input, user);
    const row: PurchaseOrder = {
      id: randomUUID(),
      supplier_id: null,
      status: "draft",
      total_cost: 0,
      notes: null,
      approved_at: null,
      ordered_at: null,
      received_at: null,
      version: 1,
      created_at: now,
      updated_at: now,
      ...input,
      plant,
    };
    this.rows.push(row);
    return row;
  }
  async update(
    id: string,
    patch: PurchaseOrderPatch,
    expectedVersion: number,
    user: UserContext,
    reason: string,
  ): Promise<UpdateResult<PurchaseOrder>> {
    await tick();
    if (!reason || reason.trim() === "") {
      throw new ApiError("VALIDATION_FAILED", "A reason is required when changing a record");
    }
    const row = this.rows.find((r) => r.id === id);
    if (!row) return { status: "missing" };
    if (user.role !== "owner" && row.plant !== user.plant) return { status: "missing" };
    if (row.version !== expectedVersion) return { status: "stale", current: { ...row } };
    Object.assign(row, patch, { version: row.version + 1, updated_at: new Date().toISOString() });
    return { status: "updated", row: { ...row } };
  }
  async remove(id: string, user: UserContext): Promise<boolean> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return false;
    if (user.role !== "owner" && row.plant !== user.plant) return false;
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.id !== id);
    return this.rows.length < before;
  }
}

/** Stock items the fakes know about, with a unit cost for pricing parts. */
export const STOCK = {
  bearing: { id: "00000000-0000-4000-8000-00000000b001", unit_cost: 150, qty_on_hand: 10 },
};

export class MemoryMaintenance extends MemoryTable<AnyRow> {
  parts: (Row & { maintenance_id: string; qty: number; unit_cost: number })[] = [];

  constructor() {
    super({ labour_cost: 0, parts_cost: 0, photo_urls: [] }, (r) => {
      r.total_cost = Number(r.labour_cost ?? 0) + Number(r.parts_cost ?? 0);
    });
  }

  override async create(input: object) {
    const { parts = [], ...log } = input as {
      parts?: { stock_item_id: string; qty: number; unit_cost?: number }[];
    };
    const row = await super.create(log);
    for (const p of parts) this.addPart(row.id, p);
    return (await this.get(row.id))!;
  }

  addPart(logId: string, p: { stock_item_id: string; qty: number; unit_cost?: number }) {
    const known = Object.values(STOCK).find((s) => s.id === p.stock_item_id);
    if (!known) throw new ApiError("NOT_FOUND", "That stock item does not exist");
    const part = {
      id: randomUUID(),
      maintenance_id: logId,
      ...p,
      unit_cost: p.unit_cost || known.unit_cost,
    };
    this.parts.push(part);
    this.refresh(logId);
    return part;
  }

  refresh(logId: string) {
    const log = this.rows.find((r) => r.id === logId);
    if (!log) return;
    log.parts_cost = this.parts
      .filter((p) => p.maintenance_id === logId)
      .reduce((s, p) => s + p.qty * p.unit_cost, 0);
    log.total_cost = Number(log.labour_cost ?? 0) + Number(log.parts_cost);
  }
}

/**
 * Figures held in memory, so the money arithmetic and the assistant can be tested without a
 * database. Every method takes the same period the real one does and filters on it, because a
 * fake that ignores the period would let a boundary fault pass.
 */
export class MemoryAnalytics implements AnalyticsRepository {
  sites: { id: string; name: string }[] = [];
  production: {
    mine_id: string;
    date: string;
    tons: number;
    magnetite: number;
    overtime: number;
  }[] = [];
  fixed: { mine_id: string; month: string; amount: number }[] = [];
  maintenance: { mine_id: string; date: string; cost: number }[] = [];
  fuel: { mine_id: string; date: string; cost: number }[] = [];
  downtime: { mine_id: string; date: string; reason: string; hours: number }[] = [];

  private within(date: string, p: Period) {
    return date >= p.from && date <= p.to;
  }

  async mines() {
    await tick();
    return this.sites;
  }

  async productionTotals(mineId: string, period: Period): Promise<ProductionTotals> {
    const rows = this.production.filter((r) => r.mine_id === mineId && this.within(r.date, period));
    return {
      tons: rows.reduce((t, r) => t + r.tons, 0),
      magnetiteCost: rows.reduce((t, r) => t + r.magnetite, 0),
      overtimeCost: rows.reduce((t, r) => t + r.overtime, 0),
      days: new Set(rows.map((r) => r.date)).size,
    };
  }

  async productionByDay(mineId: string, period: Period) {
    return this.production
      .filter((r) => r.mine_id === mineId && this.within(r.date, period))
      .map((r) => ({ date: r.date, tons: r.tons }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /** The same day-share apportionment the Supabase one does, on whole months only. */
  async fixedCosts(mineId: string, period: Period) {
    const days = (from: string, to: string) =>
      Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) +
      1;
    let total = 0;
    for (const row of this.fixed.filter((r) => r.mine_id === mineId)) {
      const first = `${row.month}-01`;
      const [y, m] = row.month.split("-").map(Number) as [number, number];
      const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      const from = first > period.from ? first : period.from;
      const to = last < period.to ? last : period.to;
      if (from > to) continue;
      total += row.amount * (days(from, to) / days(first, last));
    }
    return total;
  }

  async maintenanceCost(mineId: string, period: Period) {
    return this.maintenance
      .filter((r) => r.mine_id === mineId && this.within(r.date, period))
      .reduce((t, r) => t + r.cost, 0);
  }

  async fuelCost(mineId: string, period: Period) {
    return this.fuel
      .filter((r) => r.mine_id === mineId && this.within(r.date, period))
      .reduce((t, r) => t + r.cost, 0);
  }

  async downtimeHours(mineId: string, period: Period) {
    const byReason = new Map<string, number>();
    for (const row of this.downtime.filter(
      (r) => r.mine_id === mineId && this.within(r.date, period),
    )) {
      byReason.set(row.reason, (byReason.get(row.reason) ?? 0) + row.hours);
    }
    return [...byReason.entries()]
      .map(([reason, hours]) => ({ reason, hours }))
      .sort((a, b) => b.hours - a.hours);
  }
}

/** Leavers held in memory. The identity number is a yes or no here, as it is in the real one. */
export class MemoryRetention implements RetentionRepository {
  rows: Leaver[] = [];
  async leavers() {
    await tick();
    return [...this.rows];
  }
}

/** Notifications in memory, with the same suppression rule the database index enforces. */
export class MemoryNotifications implements NotificationRepository {
  // dedupe_key is required here because it is required in the table: the suppression rule is
  // a plain unique constraint over every row, not a partial index.
  rows: (Notification & { user_id: string; dedupe_key: string })[] = [];

  async list(userId: string, opts: { unread?: boolean; limit: number }) {
    await tick();
    return this.rows
      .filter((r) => r.user_id === userId && (!opts.unread || r.read_at === null))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, opts.limit)
      .map(({ user_id: _u, dedupe_key: _d, ...rest }) => rest);
  }

  async markRead(userId: string, id: string) {
    await tick();
    const row = this.rows.find((r) => r.id === id && r.user_id === userId && r.read_at === null);
    if (!row) return false;
    row.read_at = new Date().toISOString();
    return true;
  }
}

/** Scheduled runs in memory. `claim` races the way the unique constraint does. */
export class MemoryJobs implements JobRepository {
  rows: (JobRun & { id: string })[] = [];

  async claim(job: string, ranFor: string) {
    // No await before the check: the claim has to be one step, like the insert it stands for.
    if (this.rows.some((r) => r.job === job && r.ran_for === ranFor)) return false;
    this.rows.push({
      id: randomUUID(),
      job,
      ran_for: ranFor,
      started_at: new Date().toISOString(),
      finished_at: null,
      outcome: null,
      detail: null,
    });
    return true;
  }

  async finish(job: string, ranFor: string, outcome: string, detail: string) {
    await tick();
    const row = this.rows.find((r) => r.job === job && r.ran_for === ranFor);
    if (row) Object.assign(row, { finished_at: new Date().toISOString(), outcome, detail });
  }

  async runs(job: string, from: string, to: string) {
    await tick();
    return this.rows.filter((r) => r.job === job && r.ran_for >= from && r.ran_for <= to);
  }
}

/** What the sweep reads, and the notifications it raises, held in memory. */
export class MemorySweep implements ServiceSweepRepository {
  rows: Machine[] = [];
  /** Told about every machine, whatever plant it sits at. */
  owners: string[] = [];
  /** Plant name to the managers who belong to it. */
  managers: Record<string, string[]> = {};
  /** Mine id to the plant that operates it. A mine missing here has no plant recorded. */
  plantOfMine: Record<string, string> = {};
  raised: NotificationDraft[] = [];
  failWith: Error | null = null;

  async machines() {
    await tick();
    if (this.failWith) throw this.failWith;
    return this.rows;
  }
  async recipients(mineId: string | null) {
    await tick();
    const plant = mineId ? this.plantOfMine[mineId] : undefined;
    const atPlant = plant ? (this.managers[plant] ?? []) : [];
    return [...new Set([...this.owners, ...atPlant])];
  }
  async raise(drafts: readonly NotificationDraft[]) {
    await tick();
    let created = 0;
    for (const d of drafts) {
      const already = this.raised.some(
        (r) => r.user_id === d.user_id && r.dedupe_key === d.dedupe_key,
      );
      if (already) continue;
      this.raised.push(d);
      created += 1;
    }
    return created;
  }
}

export function testApp(overrides: Partial<Repositories> = {}) {
  const history = new MemoryHistory();
  // The signed-in user of the current request, which the history records as the actor, the
  // way the trigger reads auth.uid().
  let currentUserId: string | null = null;
  const actor = () => currentUserId;
  const mines = new MemoryMines();
  const production = new MemoryTable<AnyRow>({ tons_produced: 0 });
  const fuel = new MemoryTable<AnyRow>({ photo_urls: [] }, (r) => {
    r.total_cost = Math.round(Number(r.litres ?? 0) * Number(r.cost_per_litre ?? 0) * 100) / 100;
  });
  const maintenance = new MemoryMaintenance();
  const stock = new MemoryStock();
  const stockLevels = new MemoryStockLevel();
  const purchaseOrders = new MemoryPurchaseOrder();
  mines.audit = { table: "mines", history, actor };
  production.audit = { table: "production_logs", history, actor };
  fuel.audit = { table: "fuel_slips", history, actor };
  maintenance.audit = { table: "maintenance_logs", history, actor };
  const usage: { stock_item_id: string; qty: number }[] = [];
  const photoRequests: string[] = [];
  const analytics = new MemoryAnalytics();
  const retention = new MemoryRetention();
  const notifications = new MemoryNotifications();
  const jobs = new MemoryJobs();

  const maintenanceParts: MaintenancePartsRepository = {
    forLog: async (logId) => maintenance.parts.filter((p) => p.maintenance_id === logId),
    add: async (logId, part) => maintenance.addPart(logId, part),
    remove: async (partId) => {
      const part = maintenance.parts.find((p) => p.id === partId);
      if (!part) return false;
      maintenance.parts = maintenance.parts.filter((p) => p.id !== partId);
      maintenance.refresh(part.maintenance_id);
      return true;
    },
  };
  const stockUsage: StockUsageRepository = {
    recordUsage: async (stock_item_id, qty) => {
      const item = Object.values(STOCK).find((s) => s.id === stock_item_id);
      if (!item) throw new ApiError("NOT_FOUND", "That stock item does not exist");
      usage.push({ stock_item_id, qty });
      return { ...item, qty_on_hand: item.qty_on_hand - qty };
    },
  };
  const photos: PhotoStore = {
    uploadUrl: async (path) => {
      photoRequests.push(path);
      return { signedUrl: `https://storage.test/upload/${path}`, token: "upload-token" };
    },
    viewUrl: async (path) =>
      path.includes("forbidden") ? null : `https://storage.test/view/${path}`,
  };

  const sessionRows: UserSession[] = [];
  const settingsStore: Setting[] = [
    {
      key: "capture_max_age_days",
      value: 60,
      description: "How many days old an entry may be when it is captured.",
      updated_at: new Date().toISOString(),
    },
  ];
  const settings: SettingsRepository = {
    list: async () => settingsStore.map((x) => ({ ...x })),
    captureMaxAgeDays: async () => Number(settingsStore[0].value),
    set: async (key, value) => {
      const row = settingsStore.find((x) => x.key === key);
      if (!row) return null;
      row.value = value;
      row.updated_at = new Date().toISOString();
      return { ...row };
    },
  };

  const logged: unknown[] = [];

  const { app, registry } = createApp({
    corsOrigins: ["http://localhost:8080"],

    verifyToken: async (token) => {
      const user = USERS[token];

      if (!user) {
        throw new Error("bad token");
      }

      return {
        userId: user.id,
        sessionId: user.sessionId,
      };
    },
    repositories: (token) => {
      const user = USERS[token];
      currentUserId = user?.id ?? null;
      return {
        roles: {
          forUser: async () => user?.roles ?? [],
          plantFor: async () => user?.plant ?? null,
        },
        sessions: new MemorySessions(user?.id ?? "", sessionRows),
        settings,
        history,
        mines,
        production,
        fuel,
        maintenance,
        maintenanceParts,
        stockUsage,
        photos,
        stock,
        stockLevels,
        purchaseOrders,
        analytics,
        retention,
        notifications,
        jobs,
        ...overrides,
      };
    },
    log: (_msg, err) => logged.push(err),
  });

  const call = (method: string, path: string, opts: { token?: string; body?: unknown } = {}) =>
    app.request(path, {
      method,
      headers: {
        ...(opts.token
          ? {
              Authorization: `Bearer ${opts.token}`,
            }
          : {}),
        ...(opts.body !== undefined
          ? {
              "Content-Type": "application/json",
            }
          : {}),
      },
      body:
        opts.body === undefined
          ? undefined
          : typeof opts.body === "string"
            ? opts.body
            : JSON.stringify(opts.body),
    });

  return {
    app,
    registry,
    history,
    mines,
    production,
    fuel,
    maintenance,
    usage,
    photoRequests,
    stock,
    stockLevels,
    purchaseOrders,
    sessionRows,
    analytics,
    retention,
    notifications,
    jobs,
    settingsStore,
    logged,
    call,
  };
}
