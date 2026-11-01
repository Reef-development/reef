import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, apiListAll, ApiRequestError } from "@/lib/api";

export type TableName =
  | "clients" | "mines" | "equipment" | "suppliers"
  | "stock_items" | "purchase_orders" | "po_lines"
  | "maintenance_logs" | "maintenance_parts"
  | "production_logs" | "static_costs" | "downtime_events"
  | "employees" | "attendance" | "employee_transfers" | "fuel_slips"
  | "worker_purchases";

/**
 * Tables already served by the REEF API. Screens for these go through the API; the rest still
 * read Supabase directly until their area's endpoints are built (WBS 5.2). Add a table here when
 * its endpoints land, and nothing else in the screens needs to change.
 */
const API_PATHS: Partial<Record<TableName, string>> = {
  mines: "/api/v1/mines",
  production_logs: "/api/v1/production-logs",
  fuel_slips: "/api/v1/fuel-slips",
  maintenance_logs: "/api/v1/maintenance-logs",
};

/**
 * Fields the server owns. They are never sent back on an update. `version` is sent: an update
 * must carry the version the screen read, and the server refuses it if the record moved on.
 * So is the reason for the change: the server refuses an update without one.
 */
const SERVER_FIELDS = ["id", "created_at", "updated_at"];

/**
 * Columns that hold a date or timestamp. When a list is sorted by one of these, `useList`
 * restricts the query to the last `days` window so the browser isn't asked to render years
 * of history at once.
 */
const DATE_COLUMNS = new Set(["date", "month", "start_time", "created_at", "updated_at"]);

/** Default window for date-ordered lists. Enough for a screen; small enough to load fast. */
const DEFAULT_LIST_DAYS = 90;

/** Default cap on rows returned. Guards against any single screen loading tens of thousands. */
const DEFAULT_LIST_LIMIT = 500;

export type ListOptions = { days?: number; limit?: number };

export function useList<T = any>(
  table: TableName,
  orderBy = "created_at",
  asc = false,
  opts: ListOptions = {},
) {
  const isDateOrdered = DATE_COLUMNS.has(orderBy);
  const days = opts.days ?? DEFAULT_LIST_DAYS;
  const limit = opts.limit ?? DEFAULT_LIST_LIMIT;

  return useQuery({
    queryKey: [table, "list", orderBy, asc, days, limit],
    queryFn: async () => {
      const path = API_PATHS[table];
      if (path) {
        // The API already caps and paginates. Ask for one bounded page, not every row.
        return apiListAll<T>(path, {
          sort: orderBy,
          order: asc ? "asc" : "desc",
          limit,
        });
      }
      let q = supabase.from(table as any).select("*");
      if (isDateOrdered && days > 0) {
        const since = new Date(Date.now() - days * 864e5)
          .toISOString()
          .slice(0, 10);
        q = q.gte(orderBy, since);
      }
      const { data, error } = await q
        .order(orderBy, { ascending: asc })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });
}

/**
 * `showsConflicts`: the screen shows its own ConflictNotice when someone else saved first, so
 * no toast is needed. Screens without one still get the server's message as a toast.
 */
export function useUpsert(table: TableName, opts: { showsConflicts?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: any) => {
      const path = API_PATHS[table];
      // Why an existing record is being changed (T7). It travels apart from the record's own
      // fields because some tables already have a `reason` column that means something else
      // (a downtime cause, a transfer's reason).
      const { changeReason, ...fields } = row;
      if (path) {
        const body = Object.fromEntries(Object.entries(fields).filter(([k]) => !SERVER_FIELDS.includes(k)));
        const res = row.id
          ? await api(`${path}/${row.id}`, { method: "PATCH", body: JSON.stringify({ ...body, reason: changeReason }) })
          : await api(path, { method: "POST", body: JSON.stringify(body) });
        return res.data;
      }
      // Tables still read straight from Supabase have no history yet, so the reason stops here.
      const { data, error } = await supabase.from(table as any).upsert(fields).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [table] });
      toast.success("Saved");
    },
    onError: (e: any) => {
      // A conflict is shown inside the edit dialog, next to what the person typed.
      if (opts.showsConflicts && e instanceof ApiRequestError && e.code === "CONFLICT") return;
      toast.error(e.message ?? "Save failed");
    },
  });
}

export function useRemove(table: TableName) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const path = API_PATHS[table];
      if (path) {
        await api(`${path}/${id}`, { method: "DELETE" });
        return;
      }
      const { error } = await supabase.from(table as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [table] });
      toast.success("Deleted");
    },
    onError: (e: any) => toast.error(e.message ?? "Delete failed"),
  });
}

export const ZAR = (n: number | null | undefined) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(Number(n ?? 0));

/** Rand per ton, or "No production" when nothing was produced, never a misleading R0. */
export const RPT = (n: number | null | undefined) => (n === null || n === undefined ? "No production" : ZAR(n));

export const NUM = (n: number | null | undefined) =>
  new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 2 }).format(Number(n ?? 0));