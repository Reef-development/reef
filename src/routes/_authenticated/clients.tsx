import { createFileRoute } from "@tanstack/react-router";
import { useList, useUpsert, useRemove, ZAR } from "@/lib/reef-db";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { ResourceDialog, Field } from "@/components/ResourceDialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/clients")({ component: Page });

type Client = { id: string; name: string; contact_name?: string; contact_email?: string; contact_phone?: string; contract_start?: string; contract_end?: string; contract_revenue_monthly?: number; active: boolean; notes?: string };

function Page() {
  const list = useList<Client>("clients", "name", true);
  const upsert = useUpsert("clients");
  const remove = useRemove("clients");
  const [editing, setEditing] = useState<Client | null>(null);
  const [open, setOpen] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await upsert.mutateAsync({
      ...(editing?.id ? { id: editing.id } : {}),
      name: f.get("name"),
      contact_name: f.get("contact_name") || null,
      contact_email: f.get("contact_email") || null,
      contact_phone: f.get("contact_phone") || null,
      contract_start: f.get("contract_start") || null,
      contract_end: f.get("contract_end") || null,
      contract_revenue_monthly: Number(f.get("contract_revenue_monthly") || 0),
      notes: f.get("notes") || null,
    });
    setOpen(false); setEditing(null);
  };

  return (
    <div>
      <PageHeader title="Clients" description="Mining companies Reef has contracts with." actions={
        <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="w-4 h-4 mr-1" />New client</Button>
      } />
      <ResourceDialog title="client" open={open} onOpenChange={setOpen} editing={!!editing} trigger={<span />}>
        {() => (
          <form onSubmit={onSubmit} className="space-y-3">
            <Field label="Name"><Input name="name" required defaultValue={editing?.name} /></Field>
            <Field label="Contact name"><Input name="contact_name" defaultValue={editing?.contact_name ?? ""} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email"><Input name="contact_email" type="email" defaultValue={editing?.contact_email ?? ""} /></Field>
              <Field label="Phone"><Input name="contact_phone" defaultValue={editing?.contact_phone ?? ""} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Contract start"><Input name="contract_start" type="date" defaultValue={editing?.contract_start ?? ""} /></Field>
              <Field label="Contract end"><Input name="contract_end" type="date" defaultValue={editing?.contract_end ?? ""} /></Field>
            </div>
            <Field label="Monthly revenue (ZAR)"><Input name="contract_revenue_monthly" type="number" step="0.01" defaultValue={editing?.contract_revenue_monthly ?? ""} placeholder="0" /></Field>
            <Field label="Notes"><Textarea name="notes" rows={2} defaultValue={editing?.notes ?? ""} /></Field>
            <Button type="submit" className="w-full">Save</Button>
          </form>
        )}
      </ResourceDialog>
      <DataTable
        rows={list.data ?? []}
        columns={[
          { key: "name", label: "Name" },
          { key: "contact_name", label: "Contact" },
          { key: "contact_email", label: "Email" },
          { key: "contract_revenue_monthly", label: "Monthly", render: (r) => ZAR(r.contract_revenue_monthly) },
          { key: "active", label: "Status", render: (r) => <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "Active" : "Inactive"}</Badge> },
        ]}
        onEdit={(r) => { setEditing(r); setOpen(true); }}
        onDelete={(r) => remove.mutate(r.id)}
      />
    </div>
  );
}