import { createFileRoute } from "@tanstack/react-router";
import { useList, useUpsert, useRemove } from "@/lib/reef-db";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { Field } from "@/components/ResourceDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/suppliers")({ component: Page });

function Page() {
  const list = useList<any>("suppliers", "name", true);
  const upsert = useUpsert("suppliers");
  const remove = useRemove("suppliers");
  const [editing, setEditing] = useState<any>(null);
  const [open, setOpen] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await upsert.mutateAsync({
      ...(editing?.id ? { id: editing.id } : {}),
      name: f.get("name"), contact_name: f.get("contact_name") || null,
      email: f.get("email") || null, phone: f.get("phone") || null,
      notes: f.get("notes") || null,
    });
    setOpen(false);
  };

  return (
    <div>
      <PageHeader title="Suppliers" description="Vendors of parts, magnetite and consumables." actions={
        <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="w-4 h-4 mr-1" />New supplier</Button>
      } />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit supplier" : "New supplier"}</DialogTitle></DialogHeader>
          <form onSubmit={onSubmit} className="space-y-3">
            <Field label="Name"><Input name="name" required defaultValue={editing?.name} /></Field>
            <Field label="Contact name"><Input name="contact_name" defaultValue={editing?.contact_name ?? ""} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email"><Input name="email" type="email" defaultValue={editing?.email ?? ""} /></Field>
              <Field label="Phone"><Input name="phone" defaultValue={editing?.phone ?? ""} /></Field>
            </div>
            <Field label="Notes"><Textarea name="notes" rows={2} defaultValue={editing?.notes ?? ""} /></Field>
            <Button type="submit" className="w-full">Save</Button>
          </form>
        </DialogContent>
      </Dialog>
      <DataTable rows={list.data ?? []} columns={[
        { key: "name", label: "Supplier" },
        { key: "contact_name", label: "Contact" },
        { key: "email", label: "Email" },
        { key: "phone", label: "Phone" },
      ]} onEdit={(r) => { setEditing(r); setOpen(true); }} onDelete={(r) => remove.mutate(r.id)} />
    </div>
  );
}