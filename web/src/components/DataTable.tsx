import { useMemo, useState, type ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowDown, ArrowUp, ArrowUpDown, Pencil, Trash2 } from "lucide-react";

type Plain = string | number | null | undefined;

export type Column<T> = {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  /** Lets the person sort by this column by clicking its heading. */
  sortable?: boolean;
  /**
   * The plain value used to sort and search this column, when the cell shows something richer
   * (a name looked up from an id, a formatted amount). Defaults to the row's own field.
   */
  value?: (row: T) => Plain;
};

type Sort = { key: string; dir: "asc" | "desc" };

/** Empty values always sort last, whichever way the column is sorted. */
function compare(a: Plain, b: Plain, dir: Sort["dir"]): number {
  const emptyA = a === null || a === undefined || a === "";
  const emptyB = b === null || b === undefined || b === "";
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  const order = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
  return dir === "asc" ? order : -order;
}

export function DataTable<T extends { id: string }>({
  rows, columns, onEdit, onDelete, empty, searchable, searchLabel = "Search", pageSize,
}: {
  rows: T[]; columns: Column<T>[];
  onEdit?: (row: T) => void; onDelete?: (row: T) => void;
  empty?: string;
  /** Shows a search box that keeps only rows where any column contains the text. */
  searchable?: boolean;
  searchLabel?: string;
  /** Shows this many rows at a time, with page controls. */
  pageSize?: number;
}) {
  const [sort, setSort] = useState<Sort | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const valueOf = (row: T, col: Column<T>): Plain =>
    col.value ? col.value(row) : ((row as Record<string, unknown>)[col.key] as Plain);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = q
      ? rows.filter((row) => columns.some((c) => String(valueOf(row, c) ?? "").toLowerCase().includes(q)))
      : rows;
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) out = [...out].sort((a, b) => compare(valueOf(a, col), valueOf(b, col), sort.dir));
    }
    return out;
    // valueOf only reads columns, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns, query, sort]);

  const pages = pageSize ? Math.max(1, Math.ceil(shown.length / pageSize)) : 1;
  const current = Math.min(page, pages);
  const visible = pageSize ? shown.slice((current - 1) * pageSize, current * pageSize) : shown;

  const toggleSort = (key: string) => {
    setSort((s) => (s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));
    setPage(1);
  };

  if (!rows.length) return <div className="text-center text-sm text-muted-foreground py-12 border rounded-md">{empty ?? "No records yet."}</div>;

  return (
    <div className="space-y-3">
      {searchable && (
        <Input
          type="search"
          aria-label={searchLabel}
          placeholder={`${searchLabel}…`}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          className="max-w-xs"
        />
      )}
      <div className="border rounded-md bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => {
                const active = sort?.key === c.key ? sort.dir : null;
                return (
                  <TableHead
                    key={c.key}
                    aria-sort={c.sortable ? (active === "asc" ? "ascending" : active === "desc" ? "descending" : "none") : undefined}
                  >
                    {c.sortable ? (
                      <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-foreground">
                        {c.label}
                        {active === "asc" ? <ArrowUp className="w-3 h-3" aria-hidden /> : active === "desc" ? <ArrowDown className="w-3 h-3" aria-hidden /> : <ArrowUpDown className="w-3 h-3 opacity-50" aria-hidden />}
                      </button>
                    ) : c.label}
                  </TableHead>
                );
              })}
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="text-center text-sm text-muted-foreground py-8">
                  No records match “{query}”.
                </TableCell>
              </TableRow>
            ) : visible.map((row) => (
              <TableRow key={row.id}>
                {columns.map((c) => <TableCell key={c.key}>{c.render ? c.render(row) : (row as any)[c.key] ?? "—"}</TableCell>)}
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {onEdit && <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => onEdit(row)}><Pencil className="w-4 h-4" /></Button>}
                    {onDelete && <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => { if (confirm("Delete this record?")) onDelete(row); }}><Trash2 className="w-4 h-4" /></Button>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {pageSize && shown.length > 0 && (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {(current - 1) * pageSize + 1}–{Math.min(current * pageSize, shown.length)} of {shown.length}
          </span>
          <span className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setPage(current - 1)} disabled={current <= 1}>Previous</Button>
            <span>Page {current} of {pages}</span>
            <Button size="sm" variant="outline" onClick={() => setPage(current + 1)} disabled={current >= pages}>Next</Button>
          </span>
        </nav>
      )}
    </div>
  );
}
