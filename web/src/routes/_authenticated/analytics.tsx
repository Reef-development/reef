import { createFileRoute, Link } from "@tanstack/react-router";
import { useList, ZAR, NUM } from "@/lib/reef-db";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, LineChart, Line } from "recharts";
import { useMemo } from "react";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({
    meta: [
      { title: "Cost Analytics — REEF Operations" },
      { name: "description", content: "Deep rand-per-ton analytics: static vs variable costs, cost composition by month and cost per ton by mine." },
      { property: "og:title", content: "Cost Analytics — REEF Operations" },
      { property: "og:description", content: "Deep rand-per-ton analytics across every REEF mine contract." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});

const COLORS = { statics: "#64748b", maint: "#3b82f6", mag: "#c9a227", ot: "#ef4444" };

function Page() {
  const production = useList<any>("production_logs", "date");
  const maint = useList<any>("maintenance_logs", "date");
  const staticCosts = useList<any>("static_costs", "month");
  const mines = useList<any>("mines");
  const equipment = useList<any>("equipment");

  const model = useMemo(() => {
    const now = new Date();
    const months: any[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const prod = (production.data ?? []).filter((p) => { const pd = new Date(p.date); return pd >= d && pd < next; });
      const mlogs = (maint.data ?? []).filter((m) => { const md = new Date(m.date); return md >= d && md < next; });
      const tons = prod.reduce((s, p) => s + Number(p.tons_produced), 0);
      const mag = prod.reduce((s, p) => s + Number(p.magnetite_cost), 0);
      const ot = prod.reduce((s, p) => s + Number(p.overtime_cost), 0);
      const mt = mlogs.reduce((s, m) => s + Number(m.total_cost), 0);
      const st = (staticCosts.data ?? []).filter((s) => { const sd = new Date(s.month); return sd.getMonth() === d.getMonth() && sd.getFullYear() === d.getFullYear(); })
        .reduce((s, x) => s + Number(x.amount), 0);
      const total = mag + ot + mt + st;
      months.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        month: d.toLocaleString("default", { month: "short", year: "2-digit" }),
        tons, mag, ot, maint: mt, statics: st, total,
        rpt: tons > 0 ? total / tons : 0,
      });
    }
    const active = months.filter((m) => m.total > 0 || m.tons > 0);

    const perMine = (mines.data ?? []).map((m) => {
      const prod = (production.data ?? []).filter((p) => p.mine_id === m.id);
      const tons = prod.reduce((s, p) => s + Number(p.tons_produced), 0);
      const variable = prod.reduce((s, p) => s + Number(p.magnetite_cost) + Number(p.overtime_cost), 0);
      const eq = (equipment.data ?? []).filter((e) => e.mine_id === m.id).map((e) => e.id);
      const mt = (maint.data ?? []).filter((x) => eq.includes(x.equipment_id)).reduce((s, x) => s + Number(x.total_cost), 0);
      const total = variable + mt;
      return { id: m.id, name: m.name, tons, variable, maint: mt, total, rpt: tons > 0 ? total / tons : 0 };
    }).sort((a, b) => b.rpt - a.rpt);

    const totals = active.reduce((a, m) => ({
      tons: a.tons + m.tons, mag: a.mag + m.mag, ot: a.ot + m.ot,
      maint: a.maint + m.maint, statics: a.statics + m.statics, total: a.total + m.total,
    }), { tons: 0, mag: 0, ot: 0, maint: 0, statics: 0, total: 0 });

    return { months: active, perMine, totals, rpt: totals.tons > 0 ? totals.total / totals.tons : 0 };
  }, [production.data, maint.data, staticCosts.data, mines.data, equipment.data]);

  const variableShare = model.totals.total > 0 ? ((model.totals.total - model.totals.statics) / model.totals.total) * 100 : 0;

  return (
    <div className="reef-fade-up">
      <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2">
        <ArrowLeft className="w-4 h-4" /> Back to dashboard
      </Link>
      <PageHeader title="Cost Analytics" description="Rand per ton, decomposed. Static vs variable spend across every contract." />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Stat label="Blended Rand / Ton" value={ZAR(model.rpt)} />
        <Stat label="Total Tonnes (12m)" value={NUM(model.totals.tons)} />
        <Stat label="Total Spend (12m)" value={ZAR(model.totals.total)} />
        <Stat label="Variable share" value={`${variableShare.toFixed(0)}%`} sub={`Static ${ZAR(model.totals.statics)}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mt-6">
        <Card>
          <CardHeader><CardTitle>Cost composition by month</CardTitle></CardHeader>
          <CardContent style={{ height: 300 }}>
            {model.months.length === 0 ? <Empty /> : (
              <ResponsiveContainer><BarChart data={model.months}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" fontSize={11} /><YAxis fontSize={11} />
                <Tooltip formatter={(v: any) => ZAR(v)} /><Legend />
                <Bar dataKey="statics" stackId="a" name="Static" fill={COLORS.statics} />
                <Bar dataKey="maint" stackId="a" name="Maintenance" fill={COLORS.maint} />
                <Bar dataKey="mag" stackId="a" name="Magnetite" fill={COLORS.mag} />
                <Bar dataKey="ot" stackId="a" name="Overtime" fill={COLORS.ot} />
              </BarChart></ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Rand per ton trend</CardTitle></CardHeader>
          <CardContent style={{ height: 300 }}>
            {model.months.length === 0 ? <Empty /> : (
              <ResponsiveContainer><LineChart data={model.months}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" fontSize={11} /><YAxis fontSize={11} />
                <Tooltip formatter={(v: any) => ZAR(v)} />
                <Line type="monotone" dataKey="rpt" name="R/t" stroke={COLORS.mag} strokeWidth={2} dot={false} />
              </LineChart></ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle>Cost per ton by mine</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {model.perMine.length === 0 ? <p className="text-sm text-muted-foreground">No mines yet.</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Mine</TableHead><TableHead className="text-right">Tonnes</TableHead>
                <TableHead className="text-right">Variable</TableHead><TableHead className="text-right">Maintenance</TableHead>
                <TableHead className="text-right">Total</TableHead><TableHead className="text-right">R / ton</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {model.perMine.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="text-right">{NUM(m.tons)}</TableCell>
                    <TableCell className="text-right">{ZAR(m.variable)}</TableCell>
                    <TableCell className="text-right">{ZAR(m.maint)}</TableCell>
                    <TableCell className="text-right">{ZAR(m.total)}</TableCell>
                    <TableCell className="text-right font-semibold">{ZAR(m.rpt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader><CardTitle>Monthly ledger</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {model.months.length === 0 ? <p className="text-sm text-muted-foreground">No cost data yet.</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Month</TableHead><TableHead className="text-right">Tonnes</TableHead>
                <TableHead className="text-right">Static</TableHead><TableHead className="text-right">Maintenance</TableHead>
                <TableHead className="text-right">Magnetite</TableHead><TableHead className="text-right">Overtime</TableHead>
                <TableHead className="text-right">Total</TableHead><TableHead className="text-right">R / ton</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {model.months.map((m) => (
                  <TableRow key={m.key}>
                    <TableCell className="font-medium">{m.month}</TableCell>
                    <TableCell className="text-right">{NUM(m.tons)}</TableCell>
                    <TableCell className="text-right">{ZAR(m.statics)}</TableCell>
                    <TableCell className="text-right">{ZAR(m.maint)}</TableCell>
                    <TableCell className="text-right">{ZAR(m.mag)}</TableCell>
                    <TableCell className="text-right">{ZAR(m.ot)}</TableCell>
                    <TableCell className="text-right">{ZAR(m.total)}</TableCell>
                    <TableCell className="text-right font-semibold">{ZAR(m.rpt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </CardContent></Card>
  );
}

function Empty() {
  return <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No data yet</div>;
}
