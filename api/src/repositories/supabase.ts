import type { SupabaseClient } from "@supabase/supabase-js";
import type { ListQuery } from "@reef/shared";
import { ApiError } from "../http/errors.js";
import type { Page, Repository, RoleRepository, UpdateResult } from "./types.js";

type PgError = { code?: string; message: string };

/** Postgres and PostgREST error codes that are the caller's fault, mapped to what they mean. */
function translate(err: PgError): ApiError {
  switch (err.code) {
    case "42501":
      return new ApiError("FORBIDDEN", "You do not have permission to change this record");
    case "23505":
      return new ApiError("CONFLICT", "A record with these details already exists");
    case "23503":
      return new ApiError(
        "CONFLICT",
        "This record is linked to another record that does not exist or still uses it",
      );
    case "22P02":
      return new ApiError("VALIDATION_FAILED", "A value has the wrong format");
    default:
      return new ApiError("INTERNAL", err.message);
  }
}

/**
 * The columns that differ between `before` and `after`. A history row only carries what
 * actually changed, so a hundred edits to the same mine do not keep a hundred full copies.
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

export class SupabaseTableRepository<Row, Input, Patch> implements Repository<Row, Input, Patch> {
  constructor(
    private readonly db: SupabaseClient,
    private readonly table: string,
    private readonly defaultSort: string,
  ) {}

  async list(q: ListQuery): Promise<Page<Row>> {
    const from = (q.page - 1) * q.pageSize;
    const { data, error, count } = await this.db
      .from(this.table)
      .select("*", { count: "exact" })
      .order(q.sort ?? this.defaultSort, { ascending: q.order === "asc" })
      .range(from, from + q.pageSize - 1);
    if (error) throw translate(error);
    return { rows: (data ?? []) as Row[], total: count ?? 0 };
  }

  async get(id: string): Promise<Row | null> {
    const { data, error } = await this.db.from(this.table).select("*").eq("id", id).maybeSingle();
    if (error) throw translate(error);
    return (data as Row) ?? null;
  }

  async create(input: Input): Promise<Row> {
    const { data, error } = await this.db
      .from(this.table)
      .insert(input as object)
      .select()
      .single();
    if (error) throw translate(error);
    return data as Row;
  }

  async update(
    id: string,
    patch: Patch,
    expectedVersion: number,
    reason: string,
    changedBy: string,
  ): Promise<UpdateResult<Row>> {
    // Read the row before the update so the history row can record what changed. This is a
    // second query, but it is the one thing the version check alone cannot give us.
    const before = await this.get(id);
    if (!before) return { status: "missing" };

    // The version condition is part of the UPDATE itself, so Postgres checks it under the row
    // lock. Of two overlapping saves with the same version, the second matches no row.
    const { data, error } = await this.db
      .from(this.table)
      .update(patch as object)
      .eq("id", id)
      .eq("version", expectedVersion)
      .select()
      .maybeSingle();
    if (error) throw translate(error);

    if (!data) {
      const current = await this.get(id);
      return current ? { status: "stale", current } : { status: "missing" };
    }

    const after = data as Row;
    const { old, next } = diff(before as Record<string, unknown>, after as Record<string, unknown>);
    const afterRecord = after as Record<string, unknown>;

    // History is append-only. If the insert fails, the update has already landed: rather than
    // pretend the whole thing failed, log it and carry on. The change is real; the record of
    // it is best-effort.
    const { error: historyError } = await this.db.from("history").insert({
      table_name: this.table,
      row_id: id,
      changed_by: changedBy,
      reason,
      plant: typeof afterRecord.plant === "string" ? afterRecord.plant : null,
      old_values: old,
      new_values: next,
      version: typeof afterRecord.version === "number" ? afterRecord.version : expectedVersion + 1,
    });
    if (historyError) {
      // Nothing to throw at the caller — the update succeeded. The console is the only place
      // the miss is visible. A follow-up task should add a health check for history gaps.
      console.error("Failed to write history row", historyError);
    }

    return { status: "updated", row: after };
  }

  async remove(id: string): Promise<boolean> {
    const { data, error } = await this.db.from(this.table).delete().eq("id", id).select("id");
    if (error) throw translate(error);
    return (data ?? []).length > 0;
  }
}

export class SupabaseRoleRepository implements RoleRepository {
  constructor(private readonly db: SupabaseClient) {}

  async forUser(userId: string): Promise<string[]> {
    const { data, error } = await this.db.from("user_roles").select("role").eq("user_id", userId);
    if (error) throw translate(error);
    return (data ?? []).map((r: { role: string }) => r.role);
  }
}