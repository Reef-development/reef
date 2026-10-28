import { createFileRoute } from "@tanstack/react-router";
import { useList, useUpsert, useRemove, ZAR, NUM } from "@/lib/reef-db";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { Field } from "@/components/ResourceDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, type FormEvent } from "react";
import { Plus, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/inventory")({ component: Page });

function Page() {
  const list = useList<any>("stock_items", "name", true);
  const suppliers = useList<any>("suppliers", "name", true);
  const upsert = useUpsert("stock_items");
  const remove = useRemove("stock_items");
  const [editing, setEditing] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");

  const openNew = () => { setEditing(null); setSupplierId(""); setOpen(true); };
  const openEdit = (r: any) => { setEditing(r); setSupplierId(r.supplier_id ?? ""); setOpen(true); };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await upsert.mutateAsync({
      ...(editing?.id ? { id: editing.id } : {}),
      name: f.get("name"),
      sku: f.get("sku") || null,
      unit: f.get("unit") || "unit",
      qty_on_hand: Number(f.get("qty_on_hand") || 0),
      reorder_point: Number(f.get("reorder_point") || 0),
      reorder_qty: Number(f.get("reorder_qty") || 0),
      unit_cost: Number(f.get("unit_cost") || 0),
      supplier_id: supplierId || null,
    });
    setOpen(false);
  };

  return (
    <div>
      <PageHeader title="Inventory" description="Stock items with reorder thresholds. Draft POs are created automatically when qty falls at or below the reorder point." actions={
        <Button onClick={openNew}><Plus className="w-4 h-4 mr-1" />New stock item</Button>
      } />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit stock item" : "New stock item"}</DialogTitle></DialogHeader>
          <form onSubmit={onSubmit} className="space-y-3">
            <Field label="Name"><Input name="name" required defaultValue={editing?.name} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="SKU"><Input name="sku" defaultValue={editing?.sku ?? ""} /></Field>
              <Field label="Unit"><Input name="unit" defaultValue={editing?.unit ?? "unit"} /></Field>
            </div>
            <Field label="Supplier">
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>{suppliers.data?.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Qty on hand"><Input name="qty_on_hand" type="number" step="0.01" defaultValue={editing?.qty_on_hand ?? ""} placeholder="0" /></Field>
              <Field label="Reorder point"><Input name="reorder_point" type="number" step="0.01" defaultValue={editing?.reorder_point ?? ""} placeholder="0" /></Field>
              <Field label="Reorder qty"><Input name="reorder_qty" type="number" step="0.01" defaultValue={editing?.reorder_qty ?? ""} placeholder="0" /></Field>
            </div>
            <Field label="Unit cost (ZAR)"><Input name="unit_cost" type="number" step="0.01" defaultValue={editing?.unit_cost ?? ""} placeholder="0" /></Field>
            <Button type="submit" className="w-full">Save</Button>
          </form>
        </DialogContent>
      </Dialog>
      <DataTable rows={list.data ?? []} columns={[
        { key: "name", label: "Item" },
        { key: "sku", label: "SKU" },
        { key: "qty", label: "On hand", render: (r: any) => <span className={Number(r.qty_on_hand) <= Number(r.reorder_point) ? "text-destructive font-medium" : ""}>{NUM(r.qty_on_hand)} {r.unit}</span> },
        { key: "reorder", label: "Reorder at", render: (r: any) => `${NUM(r.reorder_point)} → ${NUM(r.reorder_qty)}` },
        { key: "cost", label: "Unit cost", render: (r: any) => ZAR(r.unit_cost) },
        { key: "supplier", label: "Supplier", render: (r: any) => suppliers.data?.find((s) => s.id === r.supplier_id)?.name ?? "—" },
        { key: "status", label: "", render: (r: any) => Number(r.qty_on_hand) <= Number(r.reorder_point) ? <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" />Low</Badge> : null },
      ]} onEdit={openEdit} onDelete={(r) => remove.mutate(r.id)} />
    </div>
  );
}