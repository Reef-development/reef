import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { useList, useUpsert, useRemove, NUM, ZAR } from "@/lib/reef-db";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { Field } from "@/components/ResourceDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/NumberField";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Fuel, Droplets, Gauge } from "lucide-react";

export const Route = createFileRoute("/_authenticated/fuel")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Fuel Slips · REEF Operations" },
      { name: "description", content: "Capture fuel slips and see exactly how much diesel or petrol was pumped into each vehicle, machine or tool." },
      { property: "og:title", content: "Fuel Slips · REEF Operations" },
      { property: "og:description", content: "Litres, rand and consumption per vehicle across every REEF mine." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const FUEL_TYPES = ["diesel", "petrol", "oil", "other"] as const;

function Page() {
  const slips = useList<any>("fuel_slips", "date");
  const mines = useList<any>("mines", "name", true);
  const equipment = useList<any>("equipment", "name", true);
  const employees = useList<any>("employees", "full_name", true);
  const upsert = useUpsert("fuel_slips");
  const remove = useRemove("fuel_slips");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [mineId, setMineId] = useState("none");
  const [equipId, setEquipId] = useState("none");
  const [empId, setEmpId] = useState("none");
  const [fuelType, setFuelType] = useState<string>("diesel");
  const [litres, setLitres] = useState<number>(0);
  const [cpl, setCpl] = useState<number>(0);
  const [filterEquip, setFilterEquip] = useState("all");

  const openNew = () => {
    setEditing(null); setMineId("none"); setEquipId("none"); setEmpId("none");
    setFuelType("diesel"); setLitres(0); setCpl(0); setOpen(true);
  };
  const openEdit = (r: any) => {
    setEditing(r); setMineId(r.mine_id ?? "none"); setEquipId(r.equipment_id ?? "none");
    setEmpId(r.employee_id ?? "none"); setFuelType(r.fuel_type ?? "diesel");
    setLitres(Number(r.litres ?? 0)); setCpl(Number(r.cost_per_litre ?? 0)); setOpen(true);
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await upsert.mutateAsync({
      ...(editing?.id ? { id: editing.id } : {}),
      date: f.get("date"),
      slip_no: f.get("slip_no") || null,
      mine_id: mineId === "none" ? null : mineId,
      equipment_id: equipId === "none" ? null : equipId,
      vehicle_label: f.get("vehicle_label") || null,
      employee_id: empId === "none" ? null : empId,
      fuel_type: fuelType,
      litres,
      cost_per_litre: cpl,
      total_cost: Number((litres * cpl).toFixed(2)),
      odometer: f.get("odometer") ? Number(f.get("odometer")) : null,
      hours_reading: f.get("hours_reading") ? Number(f.get("hours_reading")) : null,
      notes: f.get("notes") || null,
    });
    setOpen(false);
  };

  const equipName = (id: string | null) => equipment.data?.find((e: any) => e.id === id)?.name ?? null;
  const assetLabel = (r: any) => equipName(r.equipment_id) ?? r.vehicle_label ?? "Unassigned";

  const rows = useMemo(
    () => (slips.data ?? []).filter((s: any) => filterEquip === "all" || s.equipment_id === filterEquip),
    [slips.data, filterEquip],
  );

  const month = new Date().toISOString().slice(0, 7);
  const mtd = (slips.data ?? []).filter((s: any) => String(s.date).slice(0, 7) === month);
  const mtdLitres = mtd.reduce((n: number, s: any) => n + Number(s.litres ?? 0), 0);
  const mtdSpend = mtd.reduce((n: number, s: any) => n + Number(s.total_cost ?? 0), 0);

  const perAsset = useMemo(() => {
    const map = new Map<string, { label: string; litres: number; cost: number; slips: number }>();
    for (const s of slips.data ?? []) {
      const key = s.equipment_id ?? s.vehicle_label ?? "unassigned";
      const cur = map.get(key) ?? { label: assetLabel(s), litres: 0, cost: 0, slips: 0 };
      cur.litres += Number(s.litres ?? 0);
      cur.cost += Number(s.total_cost ?? 0);
      cur.slips += 1;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.litres - a.litres);
  }, [slips.data, equipment.data]);

  return (
    <div>
      <PageHeader
        title="Fuel Slips"
        description="Capture every fill-up and see exactly how much fuel went into each vehicle, machine or tool."
        actions={<Button onClick={openNew}><Plus className="w-4 h-4 mr-1" />Add slip</Button>}
      />

      <div className="grid gap-3 sm:grid-cols-3 mb-6">
        <Card className="hover-lift">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Droplets className="w-4 h-4 text-primary" />Litres this month</CardTitle></CardHeader>
          <CardContent><div className="text-2xl num-mono">{NUM(mtdLitres)} L</div></CardContent>
        </Card>
        <Card className="hover-lift">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Fuel className="w-4 h-4 text-primary" />Fuel spend MTD</CardTitle></CardHeader>
          <CardContent><div className="text-2xl num-mono">{ZAR(mtdSpend)}</div></CardContent>
        </Card>
        <Card className="hover-lift">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Gauge className="w-4 h-4 text-primary" />Avg rand / litre</CardTitle></CardHeader>
          <CardContent><div className="text-2xl num-mono">{mtdLitres ? ZAR(mtdSpend / mtdLitres) : ZAR(0)}</div></CardContent>
        </Card>
      </div>

      {perAsset.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Fuel per vehicle / tool (all time)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {perAsset.map((a) => (
              <div key={a.label} className="flex items-center justify-between text-sm border-b last:border-0 py-1.5">
                <span className="font-medium">{a.label}</span>
                <span className="num-mono text-muted-foreground">{NUM(a.litres)} L · {ZAR(a.cost)} · {a.slips} slip{a.slips === 1 ? "" : "s"}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <Select value={filterEquip} onValueChange={setFilterEquip}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All vehicles" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All vehicles / tools</SelectItem>
            {equipment.data?.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit fuel slip" : "New fuel slip"}</DialogTitle></DialogHeader>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><Input name="date" type="date" required defaultValue={editing?.date ?? new Date().toISOString().slice(0, 10)} /></Field>
              <Field label="Slip no."><Input name="slip_no" defaultValue={editing?.slip_no ?? ""} /></Field>
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
              <Field label="Vehicle / tool">
                <Select value={equipId} onValueChange={setEquipId}>
                  <SelectTrigger><SelectValue placeholder="Select equipment" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not listed</SelectItem>
                    {equipment.data?.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Other vehicle label (if not listed)"><Input name="vehicle_label" placeholder="e.g. Bakkie CJ 12 345 MP" defaultValue={editing?.vehicle_label ?? ""} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Fuel type">
                <Select value={fuelType} onValueChange={setFuelType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FUEL_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Litres"><NumberField step="0.01" value={litres} onValueChange={setLitres} /></Field>
              <Field label="Rand / litre"><NumberField step="0.01" value={cpl} onValueChange={setCpl} /></Field>
            </div>
            <div className="text-sm text-muted-foreground">Total: <span className="num-mono text-foreground">{ZAR(litres * cpl)}</span></div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Odometer (km)"><Input name="odometer" type="number" step="0.1" defaultValue={editing?.odometer ?? ""} /></Field>
              <Field label="Hour meter"><Input name="hours_reading" type="number" step="0.1" defaultValue={editing?.hours_reading ?? ""} /></Field>
            </div>
            <Field label="Filled by">
              <Select value={empId} onValueChange={setEmpId}>
                <SelectTrigger><SelectValue placeholder="Select worker" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unspecified</SelectItem>
                  {employees.data?.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Notes"><Textarea name="notes" rows={2} defaultValue={editing?.notes ?? ""} /></Field>
            <Button type="submit" className="w-full">Save</Button>
          </form>
        </DialogContent>
      </Dialog>

      <DataTable
        rows={rows}
        empty="No fuel slips yet — capture your first fill-up."
        columns={[
          { key: "date", label: "Date" },
          { key: "asset", label: "Vehicle / tool", render: (r: any) => (
            <div>
              <div className="font-medium">{assetLabel(r)}</div>
              <div className="text-xs text-muted-foreground capitalize">{r.fuel_type}{r.slip_no ? ` · slip ${r.slip_no}` : ""}</div>
            </div>
          ) },
          { key: "mine", label: "Mine", render: (r: any) => mines.data?.find((m: any) => m.id === r.mine_id)?.name ?? "—" },
          { key: "litres", label: "Litres", render: (r: any) => `${NUM(r.litres)} L` },
          { key: "cost", label: "Cost", render: (r: any) => `${ZAR(r.total_cost)} @ ${ZAR(r.cost_per_litre)}/L` },
          { key: "reading", label: "Reading", render: (r: any) => r.odometer ? `${NUM(r.odometer)} km` : r.hours_reading ? `${NUM(r.hours_reading)} h` : "—" },
          { key: "by", label: "Filled by", render: (r: any) => employees.data?.find((e: any) => e.id === r.employee_id)?.full_name ?? "—" },
        ]}
        onEdit={openEdit}
        onDelete={(r) => remove.mutate(r.id)}
      />
    </div>
  );
}