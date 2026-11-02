import { createFileRoute } from "@tanstack/react-router";
import { useList, useUpsert, useRemove, ZAR } from "@/lib/reef-db";
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

export const Route = createFileRoute("/_authenticated/static-costs")({ component: Page });

function Page() {
  const list = useList<any>("static_costs", "month");
  const mines = useList<any>("mines", "name", true);
  const upsert = useUpsert("static_costs");
  const remove = useRemove("static_costs");
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
      mine_id: mineId || null,
      month: (f.get("month") as string) + "-01",
      category: f.get("category"),
      amount: Number(f.get("amount") || 0),
      notes: f.get("notes") || null,
    });
    setOpen(false);
  };

  return (
    <div>
      <PageHeader title="Static Costs" description="Monthly fixed costs: rent, salaries, insurance, licenses." actions={
        <Button onClick={openNew}><Plus className="w-4 h-4 mr-1" />New cost</Button>
      } />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit cost" : "New static cost"}</DialogTitle></DialogHeader>
          <form onSubmit={onSubmit} className="space-y-3">
            <Field label="Month"><Input name="month" type="month" required defaultValue={editing?.month?.slice(0, 7) ?? new Date().toISOString().slice(0, 7)} /></Field>
            <Field label="Mine (leave empty for company-wide)">
              <Select value={mineId} onValueChange={setMineId}>
                <SelectTrigger><SelectValue placeholder="Company-wide" /></SelectTrigger>
                <SelectContent>{mines.data?.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Category"><Input name="category" required defaultValue={editing?.category ?? ""} placeholder="Salaries, Rent…" /></Field>
            <Field label="Amount (ZAR)"><Input name="amount" type="number" step="0.01" required defaultValue={editing?.amount ?? ""} placeholder="0" /></Field>
            <Field label="Notes"><Textarea name="notes" rows={2} defaultValue={editing?.notes ?? ""} /></Field>
            <Button type="submit" className="w-full">Save</Button>
          </form>
        </DialogContent>
      </Dialog>
      <DataTable rows={list.data ?? []} columns={[
        { key: "month", label: "Month", render: (r: any) => new Date(r.month).toLocaleString("default", { month: "long", year: "numeric" }) },
        { key: "category", label: "Category" },
        { key: "mine", label: "Mine", render: (r: any) => r.mine_id ? mines.data?.find((m) => m.id === r.mine_id)?.name : "Company-wide" },
        { key: "amount", label: "Amount", render: (r: any) => ZAR(r.amount) },
      ]} onEdit={openEdit} onDelete={(r) => remove.mutate(r.id)} />
    </div>
  );
}