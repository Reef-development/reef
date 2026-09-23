import { createFileRoute } from "@tanstack/react-router";
import { useList, ZAR, NUM } from "@/lib/reef-db";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { Field } from "@/components/ResourceDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/NumberField";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/maintenance")({ component: Page });

type PartRow = { stock_item_id: string; qty: number };

function Page() {
  const list = useList<any>("maintenance_logs", "date");
  const equipment = useList<any>("equipment", "name", true);
  const stock = useList<any>("stock_items", "name", true);
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("maintenance_logs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["maintenance_logs"] }); toast.success("Deleted"); },
  });

  const [open, setOpen] = useState(false);
  const [equipId, setEquipId] = useState("");
  const [parts, setParts] = useState<PartRow[]>([]);

  const openNew = () => { setEquipId(""); setParts([]); setOpen(true); };

  const saveLog = useMutation({
    mutationFn: async (payload: any) => {
      const { data: log, error } = await supabase.from("maintenance_logs").insert(payload).select().single();
      if (error) throw error;
      const cleanParts = parts.filter((p) => p.stock_item_id && p.qty > 0);
      if (cleanParts.length) {
        const rows = cleanParts.map((p) => ({ maintenance_id: log.id, stock_item_id: p.stock_item_id, qty: p.qty }));
        const { error: pe } = await supabase.from("maintenance_parts").insert(rows);
        if (pe) throw pe;
      }
      return log;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance_logs"] });
      qc.invalidateQueries({ queryKey: ["stock_items"] });
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      toast.success("Repair logged. Stock updated and POs drafted where needed.");
      setOpen(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (!equipId) return toast.error("Select equipment");
    saveLog.mutate({
      equipment_id: equipId,
      date: f.get("date"),
      description: f.get("description"),
      labor_hours: Number(f.get("labor_hours") || 0),
      labor_cost: Number(f.get("labor_cost") || 0),
      other_cost: Number(f.get("other_cost") || 0),
      next_due_date: f.get("next_due_date") || null,
      next_due_tons: Number(f.get("next_due_tons") || 0) || null,
      notes: f.get("notes") || null,
    });
  };

  return (
    <div>
      <PageHeader title="Maintenance & Repairs" description="Log repairs, consume parts (stock decrements automatically), schedule next service." actions={
        <Button onClick={openNew}><Plus className="w-4 h-4 mr-1" />Log repair</Button>
      } />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New repair log</DialogTitle></DialogHeader>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Equipment">
                <Select value={equipId} onValueChange={setEquipId}>
                  <SelectTrigger><SelectValue placeholder="Select equipment" /></SelectTrigger>
                  <SelectContent>{equipment.data?.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Date"><Input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
            </div>
            <Field label="Description"><Input name="description" required placeholder="What was repaired" /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Labor hours"><Input name="labor_hours" type="number" step="0.01" placeholder="0" /></Field>
              <Field label="Labor cost (ZAR)"><Input name="labor_cost" type="number" step="0.01" placeholder="0" /></Field>
              <Field label="Other cost (ZAR)"><Input name="other_cost" type="number" step="0.01" placeholder="0" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Next service due (date)"><Input name="next_due_date" type="date" /></Field>
              <Field label="Next service due (tons)"><Input name="next_due_tons" type="number" step="0.01" /></Field>
            </div>

            <div className="border-t pt-3">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">Parts consumed</label>
                <Button type="button" size="sm" variant="outline" onClick={() => setParts([...parts, { stock_item_id: "", qty: 1 }])}>
                  <Plus className="w-3 h-3 mr-1" />Add part
                </Button>
              </div>
              {parts.length === 0 && <p className="text-xs text-muted-foreground">No parts. Add to consume from inventory.</p>}
              {parts.map((p, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <Select value={p.stock_item_id} onValueChange={(v) => { const n = [...parts]; n[i].stock_item_id = v; setParts(n); }}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Select part" /></SelectTrigger>
                    <SelectContent>{stock.data?.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({NUM(s.qty_on_hand)} on hand)</SelectItem>)}</SelectContent>
                  </Select>
                  <NumberField step="0.01" className="w-24 shrink-0" value={p.qty}
                    onValueChange={(v) => { const n = [...parts]; n[i].qty = v; setParts(n); }} />
                  <Button type="button" size="icon" variant="ghost" onClick={() => setParts(parts.filter((_, j) => j !== i))}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>

            <Field label="Notes"><Textarea name="notes" rows={2} /></Field>
            <Button type="submit" className="w-full" disabled={saveLog.isPending}>{saveLog.isPending ? "Saving…" : "Save repair"}</Button>
          </form>
        </DialogContent>
      </Dialog>
      <DataTable rows={list.data ?? []} columns={[
        { key: "date", label: "Date" },
        { key: "equipment", label: "Equipment", render: (r: any) => equipment.data?.find((e) => e.id === r.equipment_id)?.name ?? "—" },
        { key: "description", label: "Description" },
        { key: "total_cost", label: "Total cost", render: (r: any) => ZAR(r.total_cost) },
        { key: "next", label: "Next due", render: (r: any) => {
          if (!r.next_due_date) return "—";
          const overdue = new Date(r.next_due_date) < new Date();
          return <Badge variant={overdue ? "destructive" : "secondary"}>{r.next_due_date}</Badge>;
        } },
      ]} onDelete={(r) => remove.mutate(r.id)} />
    </div>
  );
}