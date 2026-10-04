import { randomUUID } from "node:crypto";
import type { HistoryQuery, ListQuery, Mine, MineInput, MinePatch } from "@reef/shared";
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

/** Yields to other pending requests, so overlapping calls in a test really do interleave. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Token → user and the roles stored for them, standing in for Supabase Auth and `user_roles`. */
export const USERS: Record<string, { id: string; roles: string[] }> = {
  "owner-token": { id: "00000000-0000-4000-8000-000000000001", roles: ["owner"] },
  "manager-token": { id: "00000000-0000-4000-8000-000000000002", roles: ["manager"] },
  "worker-token": { id: "00000000-0000-4000-8000-000000000003", roles: ["worker"] },
  "legacy-token": { id: "00000000-0000-4000-8000-000000000004", roles: ["stock_controller"] },
};

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
 * The columns that differ between `before` and `after`. Mirrors the diff in the database
 * trigger, so a test can predict exactly what the history row will contain.
 */
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

  /**
   * Mirrors update_versioned: if the reason is missing, throw. The real procedure
   * raises a check_violation, which the repository translates to a 400, so a fake that
   * just silently accepts an empty reason would hide the exact bug we are guarding
   * against.
   */
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

export function testApp(overrides: Partial<Repositories> = {}) {
  const history = new MemoryHistory();

  // The fake gets a "current user id" function so it can stamp history rows with the
  // actor the same way the trigger does (via auth.uid()). The value is set inside the
  // repositories closure, so it changes per request.
  let currentUserId: string | null = null;
  const mines = new MemoryMines(history, () => currentUserId);

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

  return { app, registry, mines, history, logged, call };
}
