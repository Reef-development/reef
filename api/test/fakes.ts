import { randomUUID } from "node:crypto";
import type { ListQuery, Mine, MineInput, MinePatch } from "@reef/shared";
import { createApp } from "../src/app.js";
import type { Repositories } from "../src/repositories/index.js";
import type {
  AnalyticsRepository,
  Leaver,
  Page,
  Period,
  ProductionTotals,
  Repository,
  RetentionRepository,
  UpdateResult,
} from "../src/repositories/types.js";

/** Yields to other pending requests, so overlapping calls in a test really do interleave. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Token → user and the roles stored for them, standing in for Supabase Auth and `user_roles`. */
export const USERS: Record<string, { id: string; roles: string[] }> = {
  "owner-token": { id: "00000000-0000-4000-8000-000000000001", roles: ["owner"] },
  "manager-token": { id: "00000000-0000-4000-8000-000000000002", roles: ["manager"] },
  "worker-token": { id: "00000000-0000-4000-8000-000000000003", roles: ["worker"] },
  "legacy-token": { id: "00000000-0000-4000-8000-000000000004", roles: ["stock_controller"] },
};

export class MemoryMines implements Repository<Mine, MineInput, MinePatch> {
  rows: Mine[] = [];

  async list(q: ListQuery): Promise<Page<Mine>> {
    await tick();
    const key = (q.sort ?? "name") as keyof Mine;
    const sorted = [...this.rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
    if (q.order === "desc") sorted.reverse();
    const from = (q.page - 1) * q.pageSize;
    return { rows: sorted.slice(from, from + q.pageSize), total: this.rows.length };
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
  /** Like the database: the version check and the write happen together, with no await between. */
  async update(id: string, patch: MinePatch, expectedVersion: number): Promise<UpdateResult<Mine>> {
    await tick();
    const row = this.rows.find((r) => r.id === id);
    if (!row) return { status: "missing" };
    if (row.version !== expectedVersion) return { status: "stale", current: { ...row } };
    Object.assign(row, patch, { version: row.version + 1, updated_at: new Date().toISOString() });
    return { status: "updated", row: { ...row } };
  }
  async remove(id: string) {
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

export function testApp(overrides: Partial<Repositories> = {}) {
  const mines = new MemoryMines();
  const analytics = new MemoryAnalytics();
  const retention = new MemoryRetention();
  const logged: unknown[] = [];
  const { app, registry } = createApp({
    corsOrigins: ["http://localhost:8080"],
    verifyToken: async (token) => {
      const user = USERS[token];
      if (!user) throw new Error("bad token");
      return { userId: user.id };
    },
    repositories: (token) => ({
      roles: { forUser: async () => USERS[token]?.roles ?? [] },
      mines,
      analytics,
      retention,
      ...overrides,
    }),
    log: (_msg, err) => logged.push(err),
  });

  const call = (method: string, path: string, opts: { token?: string; body?: unknown } = {}) =>
    app.request(path, {
      method,
      headers: {
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body:
        opts.body === undefined
          ? undefined
          : typeof opts.body === "string"
            ? opts.body
            : JSON.stringify(opts.body),
    });

  return { app, registry, mines, analytics, retention, logged, call };
}
