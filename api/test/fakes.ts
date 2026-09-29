import { randomUUID } from "node:crypto";
import type { ListQuery, Mine } from "@reef/shared";
import { createApp } from "../src/app.js";
import { ApiError } from "../src/http/errors.js";
import type { Repositories } from "../src/repositories/index.js";
import type {
  MaintenancePartsRepository,
  Page,
  PhotoStore,
  Repository,
  Row,
  StockUsageRepository,
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

type AnyRow = { id: string; version: number } & Record<string, unknown>;

/**
 * An in-memory table that behaves like the database where the routes can tell the difference:
 * versions rise on update, the version check and the write happen together, and `derive` stands
 * in for the triggers that work out totals. The SQL itself is tested in test/db.
 */
export class MemoryTable<R extends AnyRow> implements Repository<R, object, object> {
  rows: R[] = [];

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
  /** Like the database: the version check and the write happen together, with no await between. */
  async update(id: string, patch: object, expectedVersion: number): Promise<UpdateResult<R>> {
    await tick();
    const row = this.rows.find((r) => r.id === id);
    if (!row) return { status: "missing" };
    if (row.version !== expectedVersion) return { status: "stale", current: { ...row } };
    Object.assign(row, patch, { version: row.version + 1, updated_at: new Date().toISOString() });
    this.derive(row);
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

export function testApp(overrides: Partial<Repositories> = {}) {
  const mines = new MemoryMines();
  const production = new MemoryTable<AnyRow>({ tons_produced: 0 });
  const fuel = new MemoryTable<AnyRow>({ photo_urls: [] }, (r) => {
    r.total_cost = Math.round(Number(r.litres ?? 0) * Number(r.cost_per_litre ?? 0) * 100) / 100;
  });
  const maintenance = new MemoryMaintenance();
  const usage: { stock_item_id: string; qty: number }[] = [];
  const photoRequests: string[] = [];

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
      production,
      fuel,
      maintenance,
      maintenanceParts,
      stockUsage,
      photos,
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

  return {
    app,
    registry,
    mines,
    production,
    fuel,
    maintenance,
    usage,
    photoRequests,
    logged,
    call,
  };
}
