import type { SupabaseClient } from "@supabase/supabase-js";
import type { ListQuery } from "@reef/shared";
import { ApiError } from "../http/errors.js";
import type {
  AnalyticsRepository,
  Leaver,
  Page,
  Period,
  ProductionTotals,
  Repository,
  RetentionRepository,
  RoleRepository,
  UpdateResult,
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

/** Sums the numeric column of every row, treating a missing value as zero. */
function sum<T>(rows: T[], pick: (row: T) => unknown): number {
  return rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0);
}

/** The first day of the month a date falls in, and the first day of the next one. */
function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function daysInclusive(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.floor(ms / 86_400_000) + 1;
}

function endOfMonth(monthFirstDay: string): string {
  const [y, m] = monthFirstDay.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0));
  return last.toISOString().slice(0, 10);
}

export class SupabaseAnalyticsRepository implements AnalyticsRepository {
  constructor(private readonly db: SupabaseClient) {}

  async mines() {
    const { data, error } = await this.db.from("mines").select("id, name").order("name");
    if (error) throw translate(error);
    return (data ?? []) as { id: string; name: string }[];
  }

  async productionTotals(mineId: string, period: Period): Promise<ProductionTotals> {
    const { data, error } = await this.db
      .from("production_logs")
      .select("date, tons_produced, magnetite_cost, overtime_cost")
      .eq("mine_id", mineId)
      .gte("date", period.from)
      .lte("date", period.to);
    if (error) throw translate(error);
    const rows = data ?? [];
    return {
      tons: sum(rows, (r) => r.tons_produced),
      magnetiteCost: sum(rows, (r) => r.magnetite_cost),
      overtimeCost: sum(rows, (r) => r.overtime_cost),
      days: new Set(rows.map((r) => String(r.date))).size,
    };
  }

  async productionByDay(mineId: string, period: Period) {
    const { data, error } = await this.db
      .from("production_logs")
      .select("date, tons_produced")
      .eq("mine_id", mineId)
      .gte("date", period.from)
      .lte("date", period.to)
      .order("date");
    if (error) throw translate(error);
    // A day with no shift recorded is absent rather than zero: zero means nothing was
    // produced, absent means nobody captured anything, and a chart that draws them the same
    // way hides the second problem entirely.
    const byDay = new Map<string, number>();
    for (const row of data ?? []) {
      const day = String(row.date);
      byDay.set(day, (byDay.get(day) ?? 0) + (Number(row.tons_produced) || 0));
    }
    return [...byDay.entries()].map(([date, tons]) => ({ date, tons }));
  }

  /**
   * Fixed costs are stored once per month. A period that covers part of a month gets its share
   * of that month's cost, by days, rather than all of it or none of it.
   */
  async fixedCosts(mineId: string, period: Period): Promise<number> {
    const { data, error } = await this.db
      .from("static_costs")
      .select("month, amount")
      .eq("mine_id", mineId)
      .gte("month", monthStart(period.from))
      .lte("month", monthStart(period.to));
    if (error) throw translate(error);

    let total = 0;
    for (const row of data ?? []) {
      const first = String(row.month).slice(0, 10);
      const last = endOfMonth(first);
      const overlapFrom = first > period.from ? first : period.from;
      const overlapTo = last < period.to ? last : period.to;
      if (overlapFrom > overlapTo) continue;
      const share = daysInclusive(overlapFrom, overlapTo) / daysInclusive(first, last);
      total += (Number(row.amount) || 0) * share;
    }
    return total;
  }

  async maintenanceCost(mineId: string, period: Period): Promise<number> {
    // Maintenance hangs off equipment, and equipment belongs to a site, so the site's
    // equipment is read first. Two queries rather than a join, because the client speaks
    // PostgREST rather than SQL.
    const { data: equipment, error: equipmentError } = await this.db
      .from("equipment")
      .select("id")
      .eq("mine_id", mineId);
    if (equipmentError) throw translate(equipmentError);
    const ids = (equipment ?? []).map((e: { id: string }) => e.id);
    if (ids.length === 0) return 0;

    const { data, error } = await this.db
      .from("maintenance_logs")
      .select("total_cost")
      .in("equipment_id", ids)
      .gte("date", period.from)
      .lte("date", period.to);
    if (error) throw translate(error);
    return sum(data ?? [], (r) => r.total_cost);
  }

  async fuelCost(mineId: string, period: Period): Promise<number> {
    const { data, error } = await this.db
      .from("fuel_slips")
      .select("total_cost")
      .eq("mine_id", mineId)
      .gte("date", period.from)
      .lte("date", period.to);
    if (error) throw translate(error);
    return sum(data ?? [], (r) => r.total_cost);
  }

  async downtimeHours(mineId: string, period: Period) {
    const { data, error } = await this.db
      .from("downtime_events")
      .select("reason, duration_hours, start_time")
      .eq("mine_id", mineId)
      .gte("start_time", `${period.from}T00:00:00Z`)
      .lte("start_time", `${period.to}T23:59:59Z`);
    if (error) throw translate(error);
    const byReason = new Map<string, number>();
    for (const row of data ?? []) {
      const reason = String(row.reason);
      byReason.set(reason, (byReason.get(reason) ?? 0) + (Number(row.duration_hours) || 0));
    }
    return [...byReason.entries()]
      .map(([reason, hours]) => ({ reason, hours }))
      .sort((a, b) => b.hours - a.hours);
  }
}

/**
 * Everyone who has left, for the retention report.
 *
 * `id_number` is selected but never returned. Reading a column to answer "is one still stored"
 * and returning it are different things, and the second one would put identity numbers into a
 * response body, a log and a browser cache to answer a question that only needed a yes or no.
 */
export class SupabaseRetentionRepository implements RetentionRepository {
  constructor(private readonly db: SupabaseClient) {}

  async leavers(): Promise<Leaver[]> {
    const { data, error } = await this.db
      .from("employees")
      .select("id, full_name, employee_no, left_on, id_number")
      .eq("active", false)
      .not("left_on", "is", null)
      .order("left_on", { ascending: true });
    if (error) throw translate(error);
    type Row = {
      id: string;
      full_name: string;
      employee_no: string | null;
      left_on: string;
      id_number: string | null;
    };
    return ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      full_name: r.full_name,
      employee_no: r.employee_no,
      left_on: r.left_on,
      id_number_held: typeof r.id_number === "string" && r.id_number.trim().length > 0,
    }));
  }
}
