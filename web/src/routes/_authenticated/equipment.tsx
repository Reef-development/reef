import { createFileRoute } from "@tanstack/react-router";
import { useList, useUpsert, useRemove, NUM, ZAR } from "@/lib/reef-db";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { Field } from "@/components/ResourceDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/equipment")({ component: Page });

function Page() {
  const list = useList<any>("equipment", "name", true);
  const mines = useList<any>("mines", "name", true);
  const upsert = useUpsert("equipment");
  const remove = useRemove("equipment");
  const [editing, setEditing] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [mineId, setMineId] = useState("");

  const openNew = () => { setEditing(null); setMineId(""); setOpen(true); };
  const openEdit = (r: any) => { setEditing(r); setMineId(r.mine_id ?? ""); setOpen(true); };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await upsert.mutateAsync({
      ...(editing?.id ? { id: editing.id } : {}),
      name: f.get("name"),
      type: f.get("type") || null,
      install_date: f.get("install_date") || null,
      expected_life_tons: Number(f.get("expected_life_tons") || 0) || null,
      expected_life_hours: Number(f.get("expected_life_hours") || 0) || null,
      tons_since_install: Number(f.get("tons_since_install") || 0),
      service_interval_tons: Number(f.get("service_interval_tons") || 0) || null,
      service_interval_days: Number(f.get("service_interval_days") || 0) || null,
      replacement_cost: Number(f.get("replacement_cost") || 0) || null,
      mine_id: mineId || null,
    });
    setOpen(false);
  };

  const pctLife = (r: any) => r.expected_life_tons ? Math.max(0, 100 - (Number(r.tons_since_install) / Number(r.expected_life_tons)) * 100) : null;

  return (
    <div>
      <PageHeader title="Equipment" description="Machinery and components with lifespan tracking." actions={
        <Button onClick={openNew}><Plus className="w-4 h-4 mr-1" />New equipment</Button>
      } />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit equipment" : "New equipment"}</DialogTitle></DialogHeader>
          <form onSubmit={onSubmit} className="space-y-3">
            <Field label="Name"><Input name="name" required defaultValue={editing?.name} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type"><Input name="type" defaultValue={editing?.type ?? ""} placeholder="Crusher, pump…" /></Field>
              <Field label="Mine">
                <Select value={mineId} onValueChange={setMineId}>
                  <SelectTrigger><SelectValue placeholder="Select mine" /></SelectTrigger>
                  <SelectContent>{mines.data?.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Install date"><Input name="install_date" type="date" defaultValue={editing?.install_date ?? ""} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Expected life (tons)"><Input name="expected_life_tons" type="number" step="0.01" defaultValue={editing?.expected_life_tons ?? ""} /></Field>
              <Field label="Expected life (hours)"><Input name="expected_life_hours" type="number" step="0.01" defaultValue={editing?.expected_life_hours ?? ""} /></Field>
            </div>
            <Field label="Tons processed since install"><Input name="tons_since_install" type="number" step="0.01" defaultValue={editing?.tons_since_install ?? ""} placeholder="0" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Service interval (tons)"><Input name="service_interval_tons" type="number" step="0.01" defaultValue={editing?.service_interval_tons ?? ""} /></Field>
              <Field label="Service interval (days)"><Input name="service_interval_days" type="number" defaultValue={editing?.service_interval_days ?? ""} /></Field>
            </div>
            <Field label="Replacement cost (ZAR)"><Input name="replacement_cost" type="number" step="0.01" defaultValue={editing?.replacement_cost ?? ""} /></Field>
            <Button type="submit" className="w-full">Save</Button>
          </form>
        </DialogContent>
      </Dialog>
      <DataTable
        rows={list.data ?? []}
        columns={[
          { key: "name", label: "Equipment" },
          { key: "type", label: "Type" },
          { key: "mine_id", label: "Mine", render: (r: any) => mines.data?.find((m) => m.id === r.mine_id)?.name ?? "—" },
          { key: "tons", label: "Tons since install", render: (r: any) => NUM(r.tons_since_install) },
          { key: "life", label: "Life left", render: (r: any) => {
            const p = pctLife(r);
            if (p === null) return "—";
            return <Badge variant={p < 20 ? "destructive" : p < 50 ? "secondary" : "default"}>{Math.round(p)}%</Badge>;
          } },
          { key: "rep", label: "Replacement", render: (r: any) => r.replacement_cost ? ZAR(r.replacement_cost) : "—" },
        ]}
        onEdit={openEdit}
        onDelete={(r) => remove.mutate(r.id)}
      />
    </div>
  );
}