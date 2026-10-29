import type { SupabaseClient } from "@supabase/supabase-js";
import type { ListQuery } from "@reef/shared";
import type {
  Page,
  Row,
  WorkerPurchaseFilters,
  WorkerPurchasesRepository,
} from "./types.js";

/**
 * Worker purchases, backed by Supabase. Reads are scoped by RLS on the table, so
 * this file never adds its own role filter. `summary` and `markPaid` are the only
 * two places with logic beyond a straight query.
 */
export function supabaseWorkerPurchases(db: SupabaseClient): WorkerPurchasesRepository {
  const table = "worker_purchases";

  return {
    async list(query: ListQuery, filters: WorkerPurchaseFilters): Promise<Page<Row>> {
      const from = (query.page - 1) * query.pageSize;
      const to = from + query.pageSize - 1;

      let q = db
        .from(table)
        .select("*", { count: "exact" })
        .order(query.sort ?? "date", { ascending: query.order === "asc" })
        .range(from, to);

      if (filters.status) q = q.eq("status", filters.status);
      if (filters.worker_id) q = q.eq("worker_id", filters.worker_id);
      if (filters.mine_id) q = q.eq("mine_id", filters.mine_id);
      if (filters.month) {
        const start = `${filters.month}-01`;
        const next = nextMonth(filters.month);
        q = q.gte("date", start).lt("date", next);
      }

      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as Row[], total: count ?? 0 };
    },

    async summary() {
      const startOfMonth = firstOfThisMonth();

      const [{ data: pending, error: e1 }, { data: paid, error: e2 }] = await Promise.all([
        db.from(table).select("amount").eq("status", "pending"),
        db.from(table).select("amount").eq("status", "paid").gte("paid_on", startOfMonth),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;

      const sum = (rows: { amount: unknown }[] | null) =>
        (rows ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);

      return {
        pending_count: (pending ?? []).length,
        pending_total: round2(sum(pending)),
        paid_this_month_count: (paid ?? []).length,
        paid_this_month_total: round2(sum(paid)),
      };
    },

       async create(input: unknown, loggedBy: string): Promise<Row> {
      const raw = input as Record<string, unknown>;

      // If the caller didn't say who bought it, it's their own claim. worker_id
      // comes from profiles.employee_id — the link added in migration
      // 20261008120100. The worker capture form doesn't send it because the
      // whole point is that a worker submits for themselves.
      let workerId = raw.worker_id as string | undefined;

      if (!workerId) {
        const { data: profile, error: profileError } = await db
          .from("profiles")
          .select("employee_id")
          .eq("id", loggedBy)
          .maybeSingle();
        if (profileError) throw profileError;
        workerId =
          (profile as { employee_id: string | null } | null)?.employee_id ?? undefined;
      }

      if (!workerId) {
        throw new Error(
          "This account is not linked to an employee, so a purchase cannot be recorded against it",
        );
      }

      const body = { ...raw, worker_id: workerId, logged_by: loggedBy };
      const { data, error } = await db.from(table).insert(body).select().single();
      if (error) throw error;
      return data as Row;
    },

    async setStatus(
      id: string,
      change: { status: "paid" | "voided"; reason?: string | null },
      actorId: string,
    ): Promise<Row | null> {
      const patch =
        change.status === "paid"
          ? { status: "paid", paid_on: today(), paid_by: actorId }
          : { status: "voided", voided_reason: change.reason ?? null };

      const { data, error } = await db
        .from(table)
        .update(patch)
        .eq("id", id)
        .select()
        .maybeSingle();
      if (error) throw error;
      return (data as Row | null) ?? null;
    },

    async markPaid(ids: string[], actorId: string): Promise<{ paid: number }> {
      const { data, error } = await db
        .from(table)
        .update({ status: "paid", paid_on: today(), paid_by: actorId })
        .in("id", ids)
        .eq("status", "pending")
        .select("id");
      if (error) throw error;
      return { paid: (data ?? []).length };
    },
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

function firstOfThisMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

function nextMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}