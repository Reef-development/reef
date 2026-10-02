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
import { ArrowLeft, ArrowLeftRight, CalendarCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/employees/$employeeId")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Worker Profile · REEF Operations" },
      { name: "description", content: "Attendance history, hours worked, tonnes contributed and mine transfers for a REEF crew member." },
      { property: "og:title", content: "Worker Profile · REEF Operations" },
      { property: "og:description", content: "Attendance, output and transfer history for a REEF crew member." },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const SHIFTS = ["morning", "midday", "night"] as const;
const STATUSES = ["present", "absent", "late", "leave", "sick"] as const;

function Page() {
  const { employeeId } = Route.useParams();
  const employees = useList<any>("employees", "full_name", true);
  const mines = useList<any>("mines", "name", true);
  const attendance = useList<any>("attendance", "date");
  const transfers = useList<any>("employee_transfers", "transfer_date");
  const upsertAtt = useUpsert("attendance");
  const removeAtt = useRemove("attendance");
  const upsertTransfer = useUpsert("employee_transfers");
  const upsertEmp = useUpsert("employees");

  const emp = employees.data?.find((e: any) => e.id === employeeId);
  const mineName = (id: string | null) => mines.data?.find((m: any) => m.id === id)?.name ?? "Unassigned";

  const myAtt = useMemo(
    () => (attendance.data ?? []).filter((a: any) => a.employee_id === employeeId),
    [attendance.data, employeeId],
  );
  const myTransfers = useMemo(
    () => (transfers.data ?? []).filter((t: any) => t.employee_id === employeeId),
    [transfers.data, employeeId],
  );

  const totals = useMemo(() => ({
    days: myAtt.filter((a: any) => a.status === "present" || a.status === "late").length,
    absent: myAtt.filter((a: any) => a.status !== "present" && a.status !== "late").length,
    hours: myAtt.reduce((n: number, a: any) => n + Number(a.hours_worked ?? 0), 0),
    overtime: myAtt.reduce((n: number, a: any) => n + Number(a.overtime_hours ?? 0), 0),
    tons: myAtt.reduce((n: number, a: any) => n + Number(a.tons_contributed ?? 0), 0),
  }), [myAtt]);

  const [attOpen, setAttOpen] = useState(false);
  const [editingAtt, setEditingAtt] = useState<any>(null);
  const [attShift, setAttShift] = useState<string>("morning");
  const [attStatus, setAttStatus] = useState<string>("present");
  const [transferOpen, setTransferOpen] = useState(false);
  const [toMine, setToMine] = useState("");

  const openNewAtt = () => { setEditingAtt(null); setAttShift(emp?.shift ?? "morning"); setAttStatus("present"); setAttOpen(true); };
  const openEditAtt = (r: any) => { setEditingAtt(r); setAttShift(r.shift); setAttStatus(r.status); setAttOpen(true); };

  const saveAtt = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await upsertAtt.mutateAsync({
      ...(editingAtt?.id ? { id: editingAtt.id } : {}),
      employee_id: employeeId,
      mine_id: emp?.mine_id ?? null,
      date: f.get("date"),
      shift: attShift,
      status: attStatus,
      hours_worked: Number(f.get("hours_worked") || 0),
      overtime_hours: Number(f.get("overtime_hours") || 0),
      tons_contributed: Number(f.get("tons_contributed") || 0),
      notes: f.get("notes") || null,
    });
    setAttOpen(false);
  };

  const saveTransfer = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (!toMine) return;
    await upsertTransfer.mutateAsync({
      employee_id: employeeId,
      from_mine_id: emp?.mine_id ?? null,
      to_mine_id: toMine,
      transfer_date: f.get("transfer_date"),
      reason: f.get("reason") || null,
    });
    await upsertEmp.mutateAsync({ id: employeeId, mine_id: toMine });
    setTransferOpen(false);
  };

  if (!emp) {
    return (
      <div>
        <PageHeader title="Worker" description="Loading crew member…" />
        <Link to="/employees" className="text-sm text-primary">← Back to employees</Link>
      </div>
    );
  }

  return (
    <div>
      <Link to="/employees" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary mb-3">
        <ArrowLeft className="w-4 h-4" />Employees
      </Link>
      <PageHeader
        title={emp.full_name}
        description={`${emp.position ?? "Crew"} · ${mineName(emp.mine_id)} · ${emp.shift} shift${emp.team_name ? ` · ${emp.team_name}` : ""}`}
        actions={
          <>
            <Button variant="outline" onClick={() => { setToMine(""); setTransferOpen(true); }}>
              <ArrowLeftRight className="w-4 h-4 mr-1" />Transfer
            </Button>
            <Button onClick={openNewAtt}><CalendarCheck className="w-4 h-4 mr-1" />Log attendance</Button>
          </>
        }
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5 mb-6">
        {[
          { label: "Days worked", value: NUM(totals.days) },
          { label: "Days missed", value: NUM(totals.absent) },
          { label: "Hours", value: `${NUM(totals.hours)} h` },
          { label: "Overtime", value: `${NUM(totals.overtime)} h` },
          { label: "Tonnes", value: `${NUM(totals.tons)} t` },
        ].map((s) => (
          <Card key={s.label} className="hover-lift">
            <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground font-normal">{s.label}</CardTitle></CardHeader>
            <CardContent><div className="text-xl num-mono">{s.value}</div></CardContent>
          </Card>
        ))}
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Profile</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3 text-sm">
          <Info label="Employee no." value={emp.employee_no} />
          <Info label="Phone" value={emp.phone} />
          <Info label="ID number" value={emp.id_number} />
          <Info label="Hire date" value={emp.hire_date} />
          <Info label="Hourly rate" value={`${ZAR(emp.hourly_rate)}/h`} />
          <Info label="Status" value={emp.active ? "Active" : "Inactive"} />
          {emp.notes && <div className="sm:col-span-3"><Info label="Notes" value={emp.notes} /></div>}
        </CardContent>
      </Card>

      <Dialog open={attOpen} onOpenChange={setAttOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingAtt ? "Edit attendance" : "Log attendance"}</DialogTitle></DialogHeader>
          <form onSubmit={saveAtt} className="space-y-3">
            <Field label="Date"><Input name="date" type="date" required defaultValue={editingAtt?.date ?? new Date().toISOString().slice(0, 10)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Shift">
                <Select value={attShift} onValueChange={setAttShift}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SHIFTS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Status">
                <Select value={attStatus} onValueChange={setAttStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Hours"><Input name="hours_worked" type="number" step="0.25" defaultValue={editingAtt?.hours_worked ?? 12} /></Field>
              <Field label="Overtime"><Input name="overtime_hours" type="number" step="0.25" defaultValue={editingAtt?.overtime_hours ?? ""} placeholder="0" /></Field>
              <Field label="Tonnes"><Input name="tons_contributed" type="number" step="0.01" defaultValue={editingAtt?.tons_contributed ?? ""} placeholder="0" /></Field>
            </div>
            <Field label="Notes"><Textarea name="notes" rows={2} defaultValue={editingAtt?.notes ?? ""} /></Field>
            <Button type="submit" className="w-full">Save</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Transfer to another mine</DialogTitle></DialogHeader>
          <form onSubmit={saveTransfer} className="space-y-3">
            <Field label="From"><Input value={mineName(emp.mine_id)} readOnly /></Field>
            <Field label="To mine">
              <Select value={toMine} onValueChange={setToMine}>
                <SelectTrigger><SelectValue placeholder="Select mine" /></SelectTrigger>
                <SelectContent>
                  {mines.data?.filter((m: any) => m.id !== emp.mine_id).map((m: any) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Transfer date"><Input name="transfer_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
            <Field label="Reason"><Textarea name="reason" rows={2} /></Field>
            <Button type="submit" className="w-full">Transfer worker</Button>
          </form>
        </DialogContent>
      </Dialog>

      <h2 className="text-display text-lg mb-2">Attendance</h2>
      <DataTable
        rows={myAtt}
        empty="No attendance logged for this worker yet."
        columns={[
          { key: "date", label: "Date" },
          { key: "shift", label: "Shift", render: (r: any) => <Badge variant="secondary" className="capitalize">{r.shift}</Badge> },
          { key: "status", label: "Status", render: (r: any) => <span className="capitalize">{r.status}</span> },
          { key: "hours", label: "Hours", render: (r: any) => `${NUM(r.hours_worked)} h${Number(r.overtime_hours) ? ` (+${NUM(r.overtime_hours)} OT)` : ""}` },
          { key: "tons_contributed", label: "Tonnes", render: (r: any) => NUM(r.tons_contributed) },
          { key: "notes", label: "Notes", render: (r: any) => r.notes ?? "—" },
        ]}
        onEdit={openEditAtt}
        onDelete={(r) => removeAtt.mutate(r.id)}
      />

      <h2 className="text-display text-lg mt-8 mb-2">Transfer history</h2>
      <DataTable
        rows={myTransfers}
        empty="No transfers recorded."
        columns={[
          { key: "transfer_date", label: "Date" },
          { key: "from", label: "From", render: (r: any) => mineName(r.from_mine_id) },
          { key: "to", label: "To", render: (r: any) => mineName(r.to_mine_id) },
          { key: "reason", label: "Reason", render: (r: any) => r.reason ?? "—" },
        ]}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div>{value || "—"}</div>
    </div>
  );
}