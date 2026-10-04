import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { Field } from "@/components/ResourceDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, fetchMe } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/history")({ component: Page });

export type HistoryEntry = {
  id: string;
  table_name: string;
  row_id: string;
  changed_by: string;
  changed_at: string;
  reason: string;
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  version: number;
};

/** What each kind of record is called on screen. Tables not listed show their own name. */
const RECORD_LABEL: Record<string, string> = {
  mines: "Mine",
  clients: "Client",
  equipment: "Equipment",
  suppliers: "Supplier",
  stock_items: "Stock item",
  stock_levels: "Stock level",
  purchase_orders: "Purchase order",
  po_lines: "Order line",
  maintenance_logs: "Repair",
  maintenance_parts: "Repair part",
  production_logs: "Production entry",
  static_costs: "Static cost",
  downtime_events: "Downtime",
  employees: "Employee",
  attendance: "Attendance",
  employee_transfers: "Transfer",
  fuel_slips: "Fuel slip",
};

const ALL = "all";
const LATEST = 200;

/** "tons_produced" → "Tons produced". */
const fieldLabel = (key: string) => {
  const words = key.replace(/_id$/, "").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const shown = (v: unknown) =>
  v === null || v === undefined || v === ""
    ? "—"
    : typeof v === "object"
      ? JSON.stringify(v)
      : String(v);

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(iso));

/** Each changed field with its old and new value, read out as a sentence by a screen reader. */
export function ChangeList({ entry }: { entry: HistoryEntry }) {
  const keys = Object.keys(entry.new_values);
  return (
    <ul className="space-y-0.5 text-sm">
      {keys.map((key) => (
        <li key={key}>
          <span className="font-medium">{fieldLabel(key)}</span>
          <span className="sr-only">
            {" "}
            changed from {shown(entry.old_values[key])} to {shown(entry.new_values[key])}
          </span>
          <span aria-hidden="true">
            :{" "}
            <span className="text-muted-foreground line-through">
              {shown(entry.old_values[key])}
            </span>{" "}
            → <span>{shown(entry.new_values[key])}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Page() {
  const [table, setTable] = useState<string>(ALL);
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 60_000 });
  const history = useQuery({
    queryKey: ["history", table],
    queryFn: async () => {
      const qs = new URLSearchParams({ pageSize: String(LATEST) });
      if (table !== ALL) qs.set("table", table);
      return (await api<HistoryEntry[]>(`/api/v1/history?${qs}`)).data;
    },
  });

  const who = (id: string) =>
    id === me.data?.id
      ? "You"
      : id.startsWith("00000000-0000-0000-0000")
        ? "The system"
        : `User ${id.slice(0, 8)}`;

  return (
    <div>
      <PageHeader
        title="Change history"
        description={`Every change to a saved record, with the reason given and the values before and after. The latest ${LATEST} are shown.`}
      />
      <div className="mb-4 max-w-xs">
        <Field label="Record type">
          <Select value={table} onValueChange={setTable}>
            <SelectTrigger aria-label="Record type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All records</SelectItem>
              {Object.entries(RECORD_LABEL).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      {history.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {(history.error as Error).message}
        </p>
      ) : (
        <DataTable
          rows={history.data ?? []}
          empty={history.isLoading ? "Loading the history…" : "No changes recorded yet."}
          searchable
          searchLabel="Search the history"
          pageSize={25}
          columns={[
            {
              key: "changed_at",
              label: "When",
              render: (r) => when(r.changed_at),
              value: (r) => r.changed_at,
            },
            {
              key: "table_name",
              label: "Record",
              render: (r) => RECORD_LABEL[r.table_name] ?? r.table_name,
              value: (r) => RECORD_LABEL[r.table_name] ?? r.table_name,
            },
            {
              key: "changed_by",
              label: "Who",
              render: (r) => who(r.changed_by),
              value: (r) => who(r.changed_by),
            },
            { key: "reason", label: "Reason" },
            {
              key: "change",
              label: "Old and new value",
              render: (r) => <ChangeList entry={r} />,
              value: (r) =>
                Object.keys(r.new_values)
                  .map(
                    (k) => `${fieldLabel(k)} ${shown(r.old_values[k])} ${shown(r.new_values[k])}`,
                  )
                  .join(" "),
            },
          ]}
        />
      )}
    </div>
  );
}
