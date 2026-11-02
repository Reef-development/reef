import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { useList, useUpsert, useRemove, NUM, ZAR } from "@/lib/reef-db";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { Field } from "@/components/ResourceDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/employees/")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Employees & Teams · REEF Operations" },
      { name: "description", content: "Manage REEF worker profiles, shift teams, attendance and mine assignments across all sites." },
      { property: "og:title", content: "Employees & Teams · REEF Operations" },
      { property: "og:description", content: "Worker profiles, attendance and shift-team production across every REEF mine." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const SHIFTS = ["morning", "midday", "night"] as const;

function Page() {
  const employees = useList<any>("employees", "full_name", true);
  const mines = useList<any>("mines", "name", true);
  const attendance = useList<any>("attendance", "date");
  const upsert = useUpsert("employees");
  const remove = useRemove("employees");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [mineId, setMineId] = useState("none");
  const [shift, setShift] = useState<string>("morning");
  const [filterMine, setFilterMine] = useState("all");
  const [filterShift, setFilterShift] = useState("all");

  const openNew = () => { setEditing(null); setMineId("none"); setShift("morning"); setOpen(true); };
  const openEdit = (r: any) => { setEditing(r); setMineId(r.mine_id ?? "none"); setShift(r.shift); setOpen(true); };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await upsert.mutateAsync({
      ...(editing?.id ? { id: editing.id } : {}),
      full_name: f.get("full_name"),
      employee_no: f.get("employee_no") || null,
      position: f.get("position") || null,
      phone: f.get("phone") || null,
      id_number: f.get("id_number") || null,
      hire_date: f.get("hire_date") || null,
      mine_id: mineId === "none" ? null : mineId,
      shift,
      team_name: f.get("team_name") || null,
      hourly_rate: Number(f.get("hourly_rate") || 0),
      notes: f.get("notes") || null,
      active: true,
    });
    setOpen(false);
  };

  const rows = useMemo(() => (employees.data ?? []).filter((e: any) =>
    (filterMine === "all" || e.mine_id === filterMine) &&
    (filterShift === "all" || e.shift === filterShift)
  ), [employees.data, filterMine, filterShift]);

  const shiftStats = useMemo(() => {
    const att = attendance.data ?? [];
    return SHIFTS.map((s) => {
      const list = att.filter((a: any) => a.shift === s && (filterMine === "all" || a.mine_id === filterMine));
      return {
        shift: s,
        crew: (employees.data ?? []).filter((e: any) => e.shift === s && (filterMine === "all" || e.mine_id === filterMine)).length,
        tons: list.reduce((n: number, a: any) => n + Number(a.tons_contributed ?? 0), 0),
        hours: list.reduce((n: number, a: any) => n + Number(a.hours_worked ?? 0) + Number(a.overtime_hours ?? 0), 0),
      };
    });
  }, [attendance.data, employees.data, filterMine]);

  const mineName = (id: string | null) => mines.data?.find((m: any) => m.id === id)?.name ?? "Unassigned";

  return (
    <div>
      <PageHeader
        title="Employees"
        description="Worker profiles, shift teams, attendance and mine assignments."
        actions={<Button onClick={openNew}><Plus className="w-4 h-4 mr-1" />Add worker</Button>}
      />

      <div className="grid gap-3 sm:grid-cols-3 mb-6">
        {shiftStats.map((s) => (
          <Card key={s.shift} className="hover-lift">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm capitalize flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />{s.shift} shift
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div className="text-2xl num-mono">{NUM(s.tons)} t</div>
              <div className="text-muted-foreground">{s.crew} crew · {NUM(s.hours)} h logged</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Select value={filterMine} onValueChange={setFilterMine}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All mines" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All mines</SelectItem>
            {mines.data?.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterShift} onValueChange={setFilterShift}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All shifts" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All shifts</SelectItem>
            {SHIFTS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit worker" : "New worker"}</DialogTitle></DialogHeader>
          <form onSubmit={onSubmit} className="space-y-3">
            <Field label="Full name"><Input name="full_name" required defaultValue={editing?.full_name ?? ""} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Employee no."><Input name="employee_no" defaultValue={editing?.employee_no ?? ""} /></Field>
              <Field label="Position"><Input name="position" defaultValue={editing?.position ?? ""} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone"><Input name="phone" defaultValue={editing?.phone ?? ""} /></Field>
              <Field label="ID number"><Input name="id_number" defaultValue={editing?.id_number ?? ""} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mine">
                <Select value={mineId} onValueChange={setMineId}>
                  <SelectTrigger><SelectValue placeholder="Select mine" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {mines.data?.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Shift">
                <Select value={shift} onValueChange={setShift}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SHIFTS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Team"><Input name="team_name" defaultValue={editing?.team_name ?? ""} /></Field>
              <Field label="Hourly rate (ZAR)"><Input name="hourly_rate" type="number" step="0.01" defaultValue={editing?.hourly_rate ?? ""} placeholder="0" /></Field>
            </div>
            <Field label="Hire date"><Input name="hire_date" type="date" defaultValue={editing?.hire_date ?? ""} /></Field>
            <Field label="Notes"><Textarea name="notes" rows={2} defaultValue={editing?.notes ?? ""} /></Field>
            <Button type="submit" className="w-full">Save</Button>
          </form>
        </DialogContent>
      </Dialog>

      <DataTable
        rows={rows}
        empty="No workers yet — add your first crew member."
        columns={[
          {
            key: "full_name", label: "Worker",
            render: (r: any) => (
              <Link to="/employees/$employeeId" params={{ employeeId: r.id }} className="font-medium hover:text-primary">
                {r.full_name}
                <div className="text-xs text-muted-foreground">{r.employee_no ?? "—"} · {r.position ?? "Crew"}</div>
              </Link>
            ),
          },
          { key: "mine", label: "Mine", render: (r: any) => mineName(r.mine_id) },
          { key: "shift", label: "Shift", render: (r: any) => <Badge variant="secondary" className="capitalize">{r.shift}</Badge> },
          { key: "team_name", label: "Team", render: (r: any) => r.team_name ?? "—" },
          { key: "hourly_rate", label: "Rate", render: (r: any) => ZAR(r.hourly_rate) + "/h" },
        ]}
        onEdit={openEdit}
        onDelete={(r) => remove.mutate(r.id)}
      />
    </div>
  );
}