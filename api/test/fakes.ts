import { randomUUID } from "node:crypto";
import type {
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
} from "@reef/shared";
import { createApp } from "../src/app.js";
import { ApiError } from "../src/http/errors.js";
import type { Repositories } from "../src/repositories/index.js";
import type {
  Page,
  Repository,
  ScopedRepository,
  UpdateResult,
  UserContext,
} from "../src/repositories/types.js";

/** Yields to other pending requests, so overlapping calls in a test really do interleave. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Token → user, their roles, and their plant (null for the owner, who sees every plant). */
export const USERS: Record<string, { id: string; roles: string[]; plant: string | null }> = {
  "owner-token": { id: "00000000-0000-4000-8000-000000000001", roles: ["owner"], plant: null },
  "manager-token": { id: "00000000-0000-4000-8000-000000000002", roles: ["manager"], plant: "A" },
  "worker-token": { id: "00000000-0000-4000-8000-000000000003", roles: ["worker"], plant: "A" },
  "no-plant-token": {
    id: "00000000-0000-4000-8000-000000000005",
    roles: ["manager"],
    plant: null,
  },
  "legacy-token": {
    id: "00000000-0000-4000-8000-000000000004",
    roles: ["stock_controller"],
    plant: "A",
  },
};

/**
 * The plant for a create, mirroring the real repository. A non-owner without a plant on
 * their profile cannot create — there is no plant to attribute the row to. Throws an
 * ApiError so the app's error handler maps it to 403 rather than 500.
 */
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

/** The fake stock repository. Mirrors the real one's plant filter and version check. */
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

/** The fake stock-level repository. Mirrors the real one's plant filter and version check. */
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

/** The fake purchase-order repository. Mirrors the real one's plant filter and version check. */
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

export function testApp(overrides: Partial<Repositories> = {}) {
  const mines = new MemoryMines();
  const stock = new MemoryStock();
  const stockLevels = new MemoryStockLevel();
  const purchaseOrders = new MemoryPurchaseOrder();
  const logged: unknown[] = [];
  const { app, registry } = createApp({
    corsOrigins: ["http://localhost:8080"],
    verifyToken: async (token) => {
      const user = USERS[token];
      if (!user) throw new Error("bad token");
      return { userId: user.id };
    },
    repositories: (token) => ({
      roles: {
        forUser: async () => USERS[token]?.roles ?? [],
        plantFor: async () => USERS[token]?.plant ?? null,
      },
      mines,
      stock,
      stockLevels,
      purchaseOrders,
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

  return { app, registry, mines, stock, stockLevels, purchaseOrders, logged, call };
}
