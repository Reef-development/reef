import type { SupabaseClient } from "@supabase/supabase-js";
import type { ListQuery } from "@reef/shared";
import { ApiError } from "../http/errors.js";
import type {
  HistoryEntry,
  HistoryQuery,
  HistoryRepository,
  Page,
  Repository,
  RoleRepository,
  SessionRepository,
  UpdateResult,
  UserSession,
} from "./types.js";

type PgError = { code?: string; message: string };

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
    case "23514":
      // update_versioned raises this when the reason is missing.
      return new ApiError("VALIDATION_FAILED", "A reason is required when changing a record");
    default:
      return new ApiError("INTERNAL", err.message);
  }
}

/**
 * The repository for one table. Updates go through the `update_versioned` stored procedure,
 * which sets the reason on the transaction; the trigger on the table reads it and writes the
 * history row inside the same transaction, so a change cannot land without its history.
 */
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
  ): Promise<UpdateResult<Row>> {
    // One stored procedure for every versioned table, so a table needs nothing of its own
    // to be updatable. It sets the reason, runs the UPDATE, and returns the row, or null
    // when no row matched the id and version.
    const { data, error } = await this.db.rpc("update_versioned", {
      p_table: this.table,
      p_id: id,
      p_patch: patch,
      p_expected_version: expectedVersion,
      p_reason: reason,
    });
    if (error) throw translate(error);

    if (data) {
      return { status: "updated", row: data as Row };
    }

    // No row matched the id and version. Either the id does not exist, or someone else
    // saved first. Fetch the current row to tell the difference.
    const current = await this.get(id);
    return current ? { status: "stale", current } : { status: "missing" };
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

export class SupabaseSessionRepository implements SessionRepository {
  constructor(private readonly db: SupabaseClient) {}

  async touch(sessionId: string, device: string | null, address: string | null): Promise<boolean> {
    const { data, error } = await this.db.rpc("touch_user_session", {
      _session_id: sessionId,
      _device: device,
      _address: address,
    });

    if (error) throw translate(error);

    return data === true;
  }

  async forUser(userId: string): Promise<UserSession[]> {
    const { data, error } = await this.db
      .from("user_sessions")
      .select("*")
      .eq("user_id", userId)
      .order("last_used_at", { ascending: false });

    if (error) throw translate(error);

    return (data ?? []) as UserSession[];
  }

  async revoke(sessionId: string): Promise<boolean> {
    const { data, error } = await this.db.rpc("revoke_user_session", {
      _session_id: sessionId,
    });

    if (error) throw translate(error);

    return data === true;
  }

  async revokeAll(userId: string): Promise<number> {
    const { data, error } = await this.db.rpc("revoke_all_user_sessions", {
      _target_user_id: userId,
    });

    if (error) throw translate(error);

    return typeof data === "number" ? data : 0;
  }
}

/** Reads the history table. Row-level security decides which rows the caller sees. */
export class SupabaseHistoryRepository implements HistoryRepository {
  constructor(private readonly db: SupabaseClient) {}

  async list(q: HistoryQuery): Promise<Page<HistoryEntry>> {
    const from = (q.page - 1) * q.pageSize;
    let query = this.db.from("history").select("*", { count: "exact" });
    if (q.table) query = query.eq("table_name", q.table);
    if (q.row_id) query = query.eq("row_id", q.row_id);
    const { data, error, count } = await query
      .order("changed_at", { ascending: false })
      .range(from, from + q.pageSize - 1);
    if (error) throw translate(error);
    return { rows: (data ?? []) as HistoryEntry[], total: count ?? 0 };
  }
}
