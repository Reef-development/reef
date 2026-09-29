import { createFileRoute } from "@tanstack/react-router";
import { useList, useUpsert, useRemove, ZAR } from "@/lib/reef-db";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { Field } from "@/components/ResourceDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRef, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { ConflictNotice, conflictFrom, untouchedFields, type Conflict } from "@/components/ConflictNotice";

export const Route = createFileRoute("/_authenticated/mines")({ component: Page });

function Page() {
  const list = useList<any>("mines", "name", true);
  const clients = useList<any>("clients", "name", true);
  const upsert = useUpsert("mines");
  const remove = useRemove("mines");
  const [editing, setEditing] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState<string>("");
  const [conflict, setConflict] = useState<Conflict<any> | null>(null);
  const [reloaded, setReloaded] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const openNew = () => { setEditing(null); setClientId(""); setConflict(null); setReloaded(false); setOpen(true); };
  const openEdit = (r: any) => { setEditing(r); setClientId(r.client_id ?? ""); setConflict(null); setReloaded(false); setOpen(true); };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const typed = {
      name: f.get("name"),
      location: f.get("location") || null,
      team_name: f.get("team_name") || null,
      target_cost_per_ton: Number(f.get("target_cost_per_ton") || 0) || null,
      client_id: clientId || null,
    };
    try {
      await upsert.mutateAsync({
        ...(editing?.id ? { id: editing.id, version: editing.version } : {}),
        ...typed,
      });
    } catch (err) {
      // Someone else saved first: keep the dialog and everything typed in it, and show why.
      const found = conflictFrom(err, typed, editing ?? {});
      if (found) { setConflict(found); setReloaded(false); list.refetch(); }
      return;
    }
    setOpen(false);
  };

  // Their copy becomes the one this dialog edits, so the next save carries their version. Fields
  // the person changed keep their typing; fields they left alone take the other person's values,
  // so saving again cannot quietly undo a change this person never saw.
  const loadTheirVersion = (current: any) => {
    if (!conflict) return;
    const keep = untouchedFields(conflict, ["name", "location", "team_name", "target_cost_per_ton", "client_id"]);
    for (const key of keep) {
      if (key === "client_id") { setClientId(current.client_id ?? ""); continue; }
      const input = formRef.current?.elements.namedItem(key) as HTMLInputElement | null;
      if (input) input.value = current[key] == null ? "" : String(current[key]);
    }
    setEditing(current);
    setConflict(null);
    setReloaded(true);
  };

  const clientName = (id?: string) => clients.data?.find((c) => c.id === id)?.name ?? "—";

  return (
    <div>
      <PageHeader title="Mines & Sites" description="Mine sites Reef operates at, per client." actions={
        <Button onClick={openNew}><Plus className="w-4 h-4 mr-1" />New mine</Button>
      } />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit mine" : "New mine"}</DialogTitle></DialogHeader>
          <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
            <ConflictNotice
              conflict={conflict}
              reloaded={reloaded}
              noun="site"
              labels={{ name: "Name", client_id: "Client", location: "Location", team_name: "Team name", target_cost_per_ton: "Target R/t" }}
              format={(key, v) => (key === "client_id" ? clientName(v as string) : v === null || v === undefined || v === "" ? "—" : String(v))}
              onReload={loadTheirVersion}
            />
            <Field label="Name"><Input name="name" required defaultValue={editing?.name} /></Field>
            <Field label="Client">
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>{clients.data?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Location"><Input name="location" defaultValue={editing?.location ?? ""} placeholder="e.g. Mpumalanga" /></Field>
            <Field label="Team name"><Input name="team_name" defaultValue={editing?.team_name ?? ""} /></Field>
            <Field label="Target cost per ton (ZAR)"><Input name="target_cost_per_ton" type="number" step="0.01" defaultValue={editing?.target_cost_per_ton ?? ""} /></Field>
            <Button type="submit" className="w-full">Save</Button>
          </form>
        </DialogContent>
      </Dialog>
      <DataTable
        rows={list.data ?? []}
        columns={[
          { key: "name", label: "Mine" },
          { key: "client", label: "Client", render: (r: any) => clientName(r.client_id) },
          { key: "location", label: "Location" },
          { key: "team_name", label: "Team" },
          { key: "target", label: "Target R/t", render: (r: any) => r.target_cost_per_ton ? ZAR(r.target_cost_per_ton) : "—" },
        ]}
        onEdit={openEdit}
        onDelete={(r) => remove.mutate(r.id)}
      />
    </div>
  );
}