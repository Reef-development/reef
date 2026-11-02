import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";

export type Column<T> = { key: string; label: string; render?: (row: T) => React.ReactNode };

export function DataTable<T extends { id: string }>({
  rows, columns, onEdit, onDelete, empty,
}: {
  rows: T[]; columns: Column<T>[];
  onEdit?: (row: T) => void; onDelete?: (row: T) => void;
  empty?: string;
}) {
  if (!rows.length) return <div className="text-center text-sm text-muted-foreground py-12 border rounded-md">{empty ?? "No records yet."}</div>;
  return (
    <div className="border rounded-md bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>{columns.map((c) => <TableHead key={c.key}>{c.label}</TableHead>)}<TableHead className="w-24 text-right">Actions</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              {columns.map((c) => <TableCell key={c.key}>{c.render ? c.render(row) : (row as any)[c.key] ?? "—"}</TableCell>)}
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  {onEdit && <Button size="icon" variant="ghost" onClick={() => onEdit(row)}><Pencil className="w-4 h-4" /></Button>}
                  {onDelete && <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete this record?")) onDelete(row); }}><Trash2 className="w-4 h-4" /></Button>}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// Table component may not exist — add it if missing.