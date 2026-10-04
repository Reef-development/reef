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
  NotificationDraft,
  NotificationRepository,
  Page,
  Period,
  ProductionTotals,
  Repository,
  RetentionRepository,
  ScopedRepository,
  ServiceSweepRepository,
  SessionRepository,
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

function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { old: Record<string, unknown>; next: Record<string, unknown> } {
  const old: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      old[key] = before[key];
      next[key] = after[key];
    }
  }
  return { old, next };
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

export class MemoryMines implements Repository<Mine, MineInput, MinePatch> {
  rows: Mine[] = [];

  constructor(
    private readonly history: MemoryHistory,
    private readonly currentUserId: () => string | null,
  ) {}

  async list(q: ListQuery): Promise<Page<Mine>> {
    await tick();
    const key = (q.sort ?? "name") as keyof Mine;
    const sorted = [...this.rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
    if (q.order === "desc") sorted.reverse();

    const from = (q.page - 1) * q.pageSize;

    return {
      rows: sorted.slice(from, from + q.pageSize),
      total: this.rows.length,
    };
  }

  async get(id: string) {
    await tick();
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async create(input: MineInput) {
    const now = new Date().toISOString();

    const row: Mine = {
      id: randomUUID(),
      client_id: null,
      location: null,
      team_name: null,
      target_cost_per_ton: null,
      active: true,
      version: 1,
      created_at: now,
      updated_at: now,
      ...input,
    };

    this.rows.push(row);
    return row;
  }
  async update(
    id: string,
    patch: MinePatch,
    expectedVersion: number,
    reason: string,
  ): Promise<UpdateResult<Mine>> {
    await tick();
    if (!reason || reason.trim() === "") {
      throw new ApiError("VALIDATION_FAILED", "A reason is required when changing a record");
    }
    const row = this.rows.find((r) => r.id === id);

    if (!row) return { status: "missing" };
    if (row.version !== expectedVersion) return { status: "stale", current: { ...row } };
    const before = { ...row };
    Object.assign(row, patch, { version: row.version + 1, updated_at: new Date().toISOString() });
    const after = { ...row };
    const { old, next } = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
    );
    const actor = this.currentUserId() ?? "00000000-0000-0000-0000-000000000000";
    this.history.append({
      table_name: "mines",
      row_id: id,
      changed_by: actor,
      reason,
      plant: null,
      old_values: old,
      new_values: next,
      version: after.version,
    });
    return { status: "updated", row: after };
  }
  async remove(id: string) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.id !== id);
    return this.rows.length < before;
  }
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
  ): Promise<UpdateResult<Stock>> {
    await tick();
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
  ): Promise<UpdateResult<StockLevel>> {
    await tick();
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
  ): Promise<UpdateResult<PurchaseOrder>> {
    await tick();
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
  const stock = new MemoryStock();
  const stockLevels = new MemoryStockLevel();
  const purchaseOrders = new MemoryPurchaseOrder();
  const analytics = new MemoryAnalytics();
  const retention = new MemoryRetention();
  const notifications = new MemoryNotifications();
  const jobs = new MemoryJobs();

  let currentUserId: string | null = null;
  const mines = new MemoryMines(history, () => currentUserId);

  const sessionRows: UserSession[] = [];
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
        history,
        mines,
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
    mines,
    stock,
    stockLevels,
    purchaseOrders,
    history,
    sessionRows,
    analytics,
    retention,
    notifications,
    jobs,
    logged,
    call,
  };
}
