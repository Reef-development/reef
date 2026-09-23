import { createFileRoute } from "@tanstack/react-router";
import { useList, useUpsert, useRemove, NUM, ZAR } from "@/lib/reef-db";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { Field } from "@/components/ResourceDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/production")({ component: Page });

function Page() {
  const list = useList<any>("production_logs", "date");
  const mines = useList<any>("mines", "name", true);
  const upsert = useUpsert("production_logs");
  const remove = useRemove("production_logs");
  const [editing, setEditing] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [mineId, setMineId] = useState("");
  const [shift, setShift] = useState("morning");

  const openNew = () => { setEditing(null); setMineId(""); setShift("morning"); setOpen(true); };
  const openEdit = (r: any) => { setEditing(r); setMineId(r.mine_id); setShift(r.shift ?? "morning"); setOpen(true); };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (!mineId) return;
    await upsert.mutateAsync({
      ...(editing?.id ? { id: editing.id } : {}),
      mine_id: mineId,
      date: f.get("date"),
      shift,
      team_name: f.get("team_name") || null,
      tons_produced: Number(f.get("tons_produced") || 0),
      magnetite_used: Number(f.get("magnetite_used") || 0),
      magnetite_cost: Number(f.get("magnetite_cost") || 0),
      overtime_hours: Number(f.get("overtime_hours") || 0),
      overtime_cost: Number(f.get("overtime_cost") || 0),
      notes: f.get("notes") || null,
    });
    setOpen(false);
  };

  return (
    <div>
      <PageHeader title="Production" description="Daily production logs per mine: tonnes, magnetite and overtime." actions={
        <Button onClick={openNew}><Plus className="w-4 h-4 mr-1" />Log production</Button>
      } />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit log" : "New production log"}</DialogTitle></DialogHeader>
          <form onSubmit={onSubmit} className="space-y-3">
            <Field label="Mine">
              <Select value={mineId} onValueChange={setMineId}>
                <SelectTrigger><SelectValue placeholder="Select mine" /></SelectTrigger>
                <SelectContent>{mines.data?.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Date"><Input name="date" type="date" required defaultValue={editing?.date ?? new Date().toISOString().slice(0, 10)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Shift">
                <Select value={shift} onValueChange={setShift}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["morning", "midday", "night"].map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Team"><Input name="team_name" defaultValue={editing?.team_name ?? ""} /></Field>
            </div>
            <Field label="Tons produced"><Input name="tons_produced" type="number" step="0.01" defaultValue={editing?.tons_produced ?? ""} placeholder="0" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Magnetite used (t)"><Input name="magnetite_used" type="number" step="0.01" defaultValue={editing?.magnetite_used ?? ""} placeholder="0" /></Field>
              <Field label="Magnetite cost (ZAR)"><Input name="magnetite_cost" type="number" step="0.01" defaultValue={editing?.magnetite_cost ?? ""} placeholder="0" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Overtime hours"><Input name="overtime_hours" type="number" step="0.01" defaultValue={editing?.overtime_hours ?? ""} placeholder="0" /></Field>
              <Field label="Overtime cost (ZAR)"><Input name="overtime_cost" type="number" step="0.01" defaultValue={editing?.overtime_cost ?? ""} placeholder="0" /></Field>
            </div>
            <Field label="Notes"><Textarea name="notes" rows={2} defaultValue={editing?.notes ?? ""} /></Field>
            <Button type="submit" className="w-full">Save</Button>
          </form>
        </DialogContent>
      </Dialog>
      <DataTable rows={list.data ?? []} columns={[
        { key: "date", label: "Date" },
        { key: "mine", label: "Mine", render: (r: any) => mines.data?.find((m) => m.id === r.mine_id)?.name ?? "—" },
        { key: "shift", label: "Shift", render: (r: any) => <span className="capitalize">{r.shift ?? "—"}{r.team_name ? ` · ${r.team_name}` : ""}</span> },
        { key: "tons_produced", label: "Tons", render: (r: any) => NUM(r.tons_produced) },
        { key: "mag", label: "Magnetite", render: (r: any) => `${NUM(r.magnetite_used)} t · ${ZAR(r.magnetite_cost)}` },
        { key: "ot", label: "Overtime", render: (r: any) => `${NUM(r.overtime_hours)} h · ${ZAR(r.overtime_cost)}` },
      ]} onEdit={openEdit} onDelete={(r) => remove.mutate(r.id)} />
    </div>
  );
}