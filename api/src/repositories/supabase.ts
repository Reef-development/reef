import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobRun, ListQuery, Notification } from "@reef/shared";
import type { Machine } from "../services/service-due.js";
import { ApiError } from "../http/errors.js";
import type {
  AnalyticsRepository,
  HistoryEntry,
  HistoryQuery,
  HistoryRepository,
  JobRepository,
  Leaver,
  NotificationDraft,
  NotificationRepository,
  Page,
  Period,
  ProductionTotals,
  Repository,
  RetentionRepository,
  RoleRepository,
  SessionRepository,
  ServiceSweepRepository,
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
      .select("id, full_name, employee_no, left_on")
      .eq("active", false)
      .not("left_on", "is", null)
      .order("left_on", { ascending: true });
    if (error) throw translate(error);
    type Row = { id: string; full_name: string; employee_no: string | null; left_on: string };
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) return [];

    // Identity numbers are not on the employee row. T11 moved them into
    // employee_personal_information and revoked application users from that table entirely, so
    // the only way to ask whether one is still stored is to ask the database. The function
    // returns ids and no numbers, and refuses anybody but the owner.
    const { data: holding, error: holdingError } = await this.db.rpc(
      "employees_holding_identity_number",
    );
    if (holdingError) throw translate(holdingError);
    const held = new Set(((holding ?? []) as { employee_id: string }[]).map((r) => r.employee_id));

    return rows.map((r) => ({
      id: r.id,
      full_name: r.full_name,
      employee_no: r.employee_no,
      left_on: r.left_on,
      id_number_held: held.has(r.id),
    }));
  }
}

/** A person's own notifications. Row-level security limits every call to their own rows. */
export class SupabaseNotificationRepository implements NotificationRepository {
  constructor(private readonly db: SupabaseClient) {}

  async list(userId: string, opts: { unread?: boolean; limit: number }): Promise<Notification[]> {
    let q = this.db
      .from("notifications")
      .select("id, kind, subject, body, equipment_id, mine_id, created_at, read_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(opts.limit);
    if (opts.unread) q = q.is("read_at", null);
    const { data, error } = await q;
    if (error) throw translate(error);
    return (data ?? []) as Notification[];
  }

  async markRead(userId: string, id: string): Promise<boolean> {
    // The user id is in the filter as well as in the policy. The policy is what enforces it;
    // this makes the intent readable without going to look the policy up.
    const { data, error } = await this.db
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId)
      .is("read_at", null)
      .select("id");
    if (error) throw translate(error);
    return (data ?? []).length > 0;
  }
}

/** Scheduled runs. Read by the owner through the API, written only by the sweep. */
export class SupabaseJobRepository implements JobRepository {
  constructor(private readonly db: SupabaseClient) {}

  async claim(job: string, ranFor: string): Promise<boolean> {
    const { error } = await this.db.from("job_runs").insert({ job, ran_for: ranFor });
    // 23505 is the unique violation on (job, ran_for): somebody else has the day. That is an
    // ordinary outcome here, not a failure, which is why it is checked rather than thrown.
    if (error && error.code === "23505") return false;
    if (error) throw translate(error);
    return true;
  }

  async finish(job: string, ranFor: string, outcome: string, detail: string): Promise<void> {
    const { error } = await this.db
      .from("job_runs")
      .update({ finished_at: new Date().toISOString(), outcome, detail })
      .eq("job", job)
      .eq("ran_for", ranFor);
    if (error) throw translate(error);
  }

  async runs(job: string, from: string, to: string): Promise<JobRun[]> {
    const { data, error } = await this.db
      .from("job_runs")
      .select("job, ran_for, started_at, finished_at, outcome, detail")
      .eq("job", job)
      .gte("ran_for", from)
      .lte("ran_for", to)
      .order("ran_for", { ascending: false });
    if (error) throw translate(error);
    return (data ?? []) as JobRun[];
  }
}

/**
 * What the sweep reads and writes. Built with the service credential, never from a request.
 */
export class SupabaseServiceSweepRepository implements ServiceSweepRepository {
  constructor(private readonly db: SupabaseClient) {}

  async machines(): Promise<Machine[]> {
    const { data, error } = await this.db
      .from("equipment")
      .select(
        "id, name, mine_id, status, install_date, tons_since_install, service_interval_days, service_interval_tons",
      );
    if (error) throw translate(error);
    const rows = (data ?? []) as Omit<
      Machine,
      "next_due_date" | "next_due_tons" | "last_serviced_on"
    >[];
    if (rows.length === 0) return [];

    // The latest maintenance log per machine, in one read rather than one read per machine.
    const { data: logs, error: logError } = await this.db
      .from("maintenance_logs")
      .select("equipment_id, date, next_due_date, next_due_tons")
      .in(
        "equipment_id",
        rows.map((r) => r.id),
      )
      .order("date", { ascending: false });
    if (logError) throw translate(logError);

    const latest = new Map<
      string,
      { date: string; next_due_date: string | null; next_due_tons: number | null }
    >();
    for (const log of (logs ?? []) as {
      equipment_id: string;
      date: string;
      next_due_date: string | null;
      next_due_tons: number | null;
    }[]) {
      // Ordered newest first, so the first one seen for a machine is its most recent service.
      if (!latest.has(log.equipment_id)) latest.set(log.equipment_id, log);
    }

    return rows.map((r) => {
      const log = latest.get(r.id);
      return {
        ...r,
        tons_since_install: Number(r.tons_since_install ?? 0),
        next_due_date: log?.next_due_date ?? null,
        next_due_tons: log?.next_due_tons === undefined ? null : Number(log.next_due_tons),
        last_serviced_on: log?.date ?? null,
      };
    });
  }

  async recipients(mineId: string | null): Promise<string[]> {
    // Owners always. A worker is never told, because a worker cannot book a machine in, and a
    // notification somebody can do nothing about is the kind people learn to ignore.
    //
    // Managers are told only about their own plant. That is possible because a mine now carries
    // its plant, which is what joins the mine side of the system to the people side. A mine with
    // no plant recorded reaches the owners alone: they are the ones who can fix the record, and
    // telling every manager instead would be the behaviour this replaced.
    const { data: roleRows, error: roleError } = await this.db
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["owner", "manager"]);
    if (roleError) throw translate(roleError);

    const owners = new Set<string>();
    const managers = new Set<string>();
    for (const row of (roleRows ?? []) as { user_id: string; role: string }[]) {
      if (row.role === "owner") owners.add(row.user_id);
      else managers.add(row.user_id);
    }
    // Somebody holding both roles is an owner, who sees every plant anyway.
    for (const id of owners) managers.delete(id);

    if (!mineId || managers.size === 0) return [...owners];

    const { data: mine, error: mineError } = await this.db
      .from("mines")
      .select("plant")
      .eq("id", mineId)
      .maybeSingle();
    if (mineError) throw translate(mineError);
    const plant = (mine as { plant: string | null } | null)?.plant ?? null;
    if (!plant) return [...owners];

    const { data: profiles, error: profileError } = await this.db
      .from("profiles")
      .select("id, plant")
      .eq("plant", plant)
      .in("id", [...managers]);
    if (profileError) throw translate(profileError);

    const atThisPlant = ((profiles ?? []) as { id: string }[]).map((r) => r.id);
    return [...new Set([...owners, ...atThisPlant])];
  }

  async raise(rows: readonly NotificationDraft[]): Promise<number> {
    // One statement, so that two sweeps racing cannot both create the same reminder.
    //
    // `onConflict` is a bare column list with no spaces: PostgREST splits it on the comma and
    // does not trim, so " dedupe_key" would be sent as a column name that does not exist. It
    // names the constraint the migration adds, which is a plain unique constraint rather than a
    // partial index precisely because PostgREST cannot express an index predicate here.
    //
    // `ignoreDuplicates` makes it ON CONFLICT DO NOTHING, and the select returns only the rows
    // that were really inserted, which is what the caller counts.
    const { data, error } = await this.db
      .from("notifications")
      .upsert(rows as NotificationDraft[], {
        onConflict: "user_id,dedupe_key",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) throw translate(error);
    return (data ?? []).length;
  }
}
