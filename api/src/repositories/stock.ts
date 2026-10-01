import type { SupabaseClient } from "@supabase/supabase-js";
import type { ListQuery, Stock, StockInput, StockPatch } from "@reef/shared";
import { ApiError } from "../http/errors.js";
import type { Page, ScopedRepository, UpdateResult, UserContext } from "./types.js";

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

export class SupabaseStockRepository implements ScopedRepository<Stock, StockInput, StockPatch> {
  constructor(private readonly db: SupabaseClient) {}

  async list(q: ListQuery, user: UserContext): Promise<Page<Stock>> {
    const from = (q.page - 1) * q.pageSize;
    let query = this.db.from("stock_items").select("*", { count: "exact" });
    // The plant filter lives here, in the repository, not on the screen. An owner sees every
    // plant; everyone else sees only their own. There is no code path that skips this.
    if (user.role !== "owner") {
      query = query.eq("plant", user.plant);
    }
    const { data, error, count } = await query
      .order(q.sort ?? "name", { ascending: q.order === "asc" })
      .range(from, from + q.pageSize - 1);
    if (error) throw translate(error);
    return { rows: (data ?? []) as Stock[], total: count ?? 0 };
  }

  async get(id: string, user: UserContext): Promise<Stock | null> {
    const { data, error } = await this.db
      .from("stock_items")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw translate(error);
    if (!data) return null;
    const row = data as Stock;
    // A record belonging to another plant answers "not found", not "refused": a refusal
    // would confirm the item exists.
    if (user.role !== "owner" && row.plant !== user.plant) return null;
    return row;
  }

  async create(input: StockInput, user: UserContext): Promise<Stock> {
    // A non-owner can only create stock in their own plant. The owner can create in any.
    const plant = user.role === "owner" ? input.plant : (user.plant ?? input.plant);
    const { data, error } = await this.db
      .from("stock_items")
      .insert({ ...input, plant } as object)
      .select()
      .single();
    if (error) throw translate(error);
    return data as Stock;
  }

  async update(
    id: string,
    patch: StockPatch,
    expectedVersion: number,
    user: UserContext,
  ): Promise<UpdateResult<Stock>> {
    // Check the caller can see the record before allowing a write.
    const existing = await this.get(id, user);
    if (!existing) return { status: "missing" };

    const { data, error } = await this.db
      .from("stock_items")
      .update(patch as object)
      .eq("id", id)
      .eq("version", expectedVersion)
      .select()
      .maybeSingle();
    if (error) throw translate(error);
    if (data) return { status: "updated", row: data as Stock };
    const current = await this.get(id, user);
    return current ? { status: "stale", current } : { status: "missing" };
  }

  async remove(id: string, user: UserContext): Promise<boolean> {
    const existing = await this.get(id, user);
    if (!existing) return false;
    const { data, error } = await this.db.from("stock_items").delete().eq("id", id).select("id");
    if (error) throw translate(error);
    return (data ?? []).length > 0;
  }
}
