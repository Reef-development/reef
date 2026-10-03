import type { SupabaseClient } from "@supabase/supabase-js";
import type { ListQuery } from "@reef/shared";
import { ApiError } from "../http/errors.js";
import type {
  Page,
  Repository,
  RoleRepository,
  SessionRepository,
  UpdateResult,
  UserSession,
} from "./types.js";
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

  async update(id: string, patch: Patch, expectedVersion: number): Promise<UpdateResult<Row>> {
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
    if (data) return { status: "updated", row: data as Row };
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
