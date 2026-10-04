import type { SupabaseClient } from "@supabase/supabase-js";
import type { ListQuery } from "@reef/shared";
import { ApiError } from "../http/errors.js";
import type {
  HistoryEntry,
  HistoryQuery,
  HistoryRepository,
  MaintenancePartsRepository,
  Page,
  PhotoStore,
  Repository,
  RoleRepository,
  Row,
  StockUsageRepository,
  UpdateResult,
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
    case "22023":
      return new ApiError("VALIDATION_FAILED", err.message);
    case "RF404":
      return new ApiError("NOT_FOUND", "That stock item does not exist");
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

  async plantFor(userId: string): Promise<string | null> {
    const { data, error } = await this.db
      .from("profiles")
      .select("plant")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw translate(error);
    return (data as { plant: string | null } | null)?.plant ?? null;
  }
}

/** Creating a repair goes through create_maintenance_log, so the log and its parts land together. */
export class SupabaseMaintenanceRepository<
  Input extends { parts?: unknown[] },
  Patch,
> extends SupabaseTableRepository<Row, Input, Patch> {
  constructor(private readonly client: SupabaseClient) {
    super(client, "maintenance_logs", "date");
  }

  override async create(input: Input): Promise<Row> {
    const { parts = [], ...log } = input;
    const { data, error } = await this.client.rpc("create_maintenance_log", {
      _log: log,
      _parts: parts,
    });
    if (error) throw translate(error);
    return data as Row;
  }
}

export class SupabaseMaintenanceParts implements MaintenancePartsRepository {
  constructor(private readonly db: SupabaseClient) {}

  async forLog(logId: string): Promise<Row[]> {
    const { data, error } = await this.db
      .from("maintenance_parts")
      .select("*, stock_items(name, unit)")
      .eq("maintenance_id", logId)
      .order("created_at");
    if (error) throw translate(error);
    return (data ?? []) as Row[];
  }

  async add(
    logId: string,
    part: { stock_item_id: string; qty: number; unit_cost?: number },
  ): Promise<Row> {
    const { data, error } = await this.db
      .from("maintenance_parts")
      .insert({ maintenance_id: logId, ...part })
      .select()
      .single();
    if (error) throw translate(error);
    return data as Row;
  }

  async remove(partId: string): Promise<boolean> {
    const { data, error } = await this.db
      .from("maintenance_parts")
      .delete()
      .eq("id", partId)
      .select("id");
    if (error) throw translate(error);
    return (data ?? []).length > 0;
  }
}

export class SupabaseStockUsage implements StockUsageRepository {
  constructor(private readonly db: SupabaseClient) {}

  async recordUsage(stockItemId: string, qty: number): Promise<Row> {
    const { data, error } = await this.db.rpc("record_stock_usage", {
      _item: stockItemId,
      _qty: qty,
    });
    if (error) throw translate(error);
    return data as Row;
  }
}

export class SupabasePhotoStore implements PhotoStore {
  private readonly bucket;

  constructor(db: SupabaseClient) {
    this.bucket = db.storage.from("reef-photos");
  }

  async uploadUrl(path: string) {
    const { data, error } = await this.bucket.createSignedUploadUrl(path);
    if (error) throw new ApiError("INTERNAL", error.message);
    return { signedUrl: data.signedUrl, token: data.token };
  }

  async viewUrl(path: string) {
    const { data, error } = await this.bucket.createSignedUrl(path, 3600);
    return error ? null : data.signedUrl;
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
