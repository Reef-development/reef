import { randomUUID } from "node:crypto";
import type {
  Client,
  ClientInput,
  ClientPatch,
  HistoryQuery,
  ListQuery,
  Mine,
  MineInput,
  MinePatch,
  Supplier,
  SupplierInput,
  SupplierPatch,
} from "@reef/shared";
import { createApp } from "../src/app.js";
import { ApiError } from "../src/http/errors.js";
import type { Repositories } from "../src/repositories/index.js";
import type {
  HistoryEntry,
  HistoryRepository,
  Page,
  Repository,
  UpdateResult,
} from "../src/repositories/types.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export const USERS: Record<string, { id: string; roles: string[] }> = {
  "owner-token": { id: "00000000-0000-4000-8000-000000000001", roles: ["owner"] },
  "manager-token": { id: "00000000-0000-4000-8000-000000000002", roles: ["manager"] },
  "worker-token": { id: "00000000-0000-4000-8000-000000000003", roles: ["worker"] },
  "legacy-token": { id: "00000000-0000-4000-8000-000000000004", roles: ["stock_controller"] },
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
    const full: HistoryEntry = { id: randomUUID(), changed_at: new Date().toISOString(), ...entry };
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

export class MemorySupplier implements Repository<Supplier, SupplierInput, SupplierPatch> {
  rows: Supplier[] = [];
  constructor(private readonly history: MemoryHistory) {}
  async list(q: ListQuery): Promise<Page<Supplier>> {
    await tick();
    const key = (q.sort ?? "name") as keyof Supplier;
    const sorted = [...this.rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
    if (q.order === "desc") sorted.reverse();
    const from = (q.page - 1) * q.pageSize;
    return { rows: sorted.slice(from, from + q.pageSize), total: this.rows.length };
  }
  async get(id: string) {
    await tick();
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async create(input: SupplierInput) {
    const now = new Date().toISOString();
    const row: Supplier = {
      id: randomUUID(),
      contact_name: null,
      email: null,
      phone: null,
      notes: null,
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
    patch: SupplierPatch,
    expectedVersion: number,
    reason: string,
    changedBy: string,
  ): Promise<UpdateResult<Supplier>> {
    await tick();
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
    this.history.append({
      table_name: "suppliers",
      row_id: id,
      changed_by: changedBy,
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

export class MemoryClient implements Repository<Client, ClientInput, ClientPatch> {
  rows: Client[] = [];
  constructor(private readonly history: MemoryHistory) {}
  async list(q: ListQuery): Promise<Page<Client>> {
    await tick();
    const key = (q.sort ?? "name") as keyof Client;
    const sorted = [...this.rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
    if (q.order === "desc") sorted.reverse();
    const from = (q.page - 1) * q.pageSize;
    return { rows: sorted.slice(from, from + q.pageSize), total: this.rows.length };
  }
  async get(id: string) {
    await tick();
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async create(input: ClientInput) {
    const now = new Date().toISOString();
    const row: Client = {
      id: randomUUID(),
      contact_name: null,
      contact_email: null,
      contact_phone: null,
      contract_start: null,
      contract_end: null,
      contract_revenue_monthly: null,
      active: true,
      notes: null,
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
    patch: ClientPatch,
    expectedVersion: number,
    reason: string,
    changedBy: string,
  ): Promise<UpdateResult<Client>> {
    await tick();
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
    this.history.append({
      table_name: "clients",
      row_id: id,
      changed_by: changedBy,
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

export function testApp(overrides: Partial<Repositories> = {}) {
  const history = new MemoryHistory();
  let currentUserId: string | null = null;
  const mines = new MemoryMines(history, () => currentUserId);
  const suppliers = new MemorySupplier(history);
  const clients = new MemoryClient(history);

  const logged: unknown[] = [];
  const { app, registry } = createApp({
    corsOrigins: ["http://localhost:8080"],
    verifyToken: async (token) => {
      const user = USERS[token];
      if (!user) throw new Error("bad token");
      return { userId: user.id };
    },
    repositories: (token) => {
      currentUserId = USERS[token]?.id ?? null;
      return {
        roles: { forUser: async () => USERS[token]?.roles ?? [] },
        history,
        mines,
        suppliers,
        clients,
        ...overrides,
      };
    },
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

  return { app, registry, mines, suppliers, clients, history, logged, call };
}