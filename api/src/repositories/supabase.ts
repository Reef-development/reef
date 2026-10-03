import type { SupabaseClient } from "@supabase/supabase-js";
import type { ListQuery } from "@reef/shared";
import { ApiError } from "../http/errors.js";
import type { Page, Repository, RoleRepository, UpdateResult } from "./types.js";

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
      // The history trigger raises this when the reason is missing.
      return new ApiError("VALIDATION_FAILED", "A reason is required when changing a record");
    default:
      return new ApiError("INTERNAL", err.message);
  }
}

/**
 * The repository for a table that is updated through a stored procedure. Every write to
 * one of these tables goes through `update_<table>`, which sets the reason on the
 * database session. The trigger on the table reads that reason and writes the history
 * row inside the same transaction, so an update without a reason cannot land.
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
    // Call the stored procedure, not the table. The RPC sets the reason on the session
    // and runs the UPDATE. The trigger fires inside that transaction and writes the
    // history row. If the reason is empty or the version is stale, the row is not
    // returned and we can tell the caller what happened.
    const { data, error } = await this.db.rpc(`update_${this.table}`, {
      p_id: id,
      p_patch: patch,
      p_expected_version: expectedVersion,
      p_reason: reason,
    });
    if (error) throw translate(error);

    const rows = (data ?? []) as Row[];
    if (rows.length > 0) {
      return { status: "updated", row: rows[0] };
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
