import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, apiListAll } from "@/lib/api";

export type TableName =
  | "clients" | "mines" | "equipment" | "suppliers"
  | "stock_items" | "purchase_orders" | "po_lines"
  | "maintenance_logs" | "maintenance_parts"
  | "production_logs" | "static_costs" | "downtime_events"
  | "employees" | "attendance" | "employee_transfers" | "fuel_slips";

/**
 * Tables already served by the REEF API. Screens for these go through the API; the rest still
 * read Supabase directly until their area's endpoints are built (WBS 5.2). Add a table here when
 * its endpoints land, and nothing else in the screens needs to change.
 */
const API_PATHS: Partial<Record<TableName, string>> = {
  mines: "/api/v1/mines",
};

/** Fields the server owns. They are never sent back on an update. */
const SERVER_FIELDS = ["id", "created_at", "updated_at"];

export function useList<T = any>(table: TableName, orderBy = "created_at", asc = false) {
  return useQuery({
    queryKey: [table, "list", orderBy, asc],
    queryFn: async () => {
      const path = API_PATHS[table];
      if (path) return apiListAll<T>(path, { sort: orderBy, order: asc ? "asc" : "desc" });
      const { data, error } = await supabase.from(table as any).select("*").order(orderBy, { ascending: asc });
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });
}

export function useUpsert(table: TableName) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: any) => {
      const path = API_PATHS[table];
      if (path) {
        const body = Object.fromEntries(Object.entries(row).filter(([k]) => !SERVER_FIELDS.includes(k)));
        const res = row.id
          ? await api(`${path}/${row.id}`, { method: "PATCH", body: JSON.stringify(body) })
          : await api(path, { method: "POST", body: JSON.stringify(body) });
        return res.data;
      }
      const { data, error } = await supabase.from(table as any).upsert(row).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [table] });
      toast.success("Saved");
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
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

export const NUM = (n: number | null | undefined) =>
  new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 2 }).format(Number(n ?? 0));
