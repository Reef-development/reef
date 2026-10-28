import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useList, ZAR, NUM } from "@/lib/reef-db";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, PieChart, Pie, Cell, Legend } from "recharts";
import { AlertTriangle, TrendingUp, Boxes, Wrench, Fuel } from "lucide-react";
import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const production = useList<any>("production_logs", "date");
  const maint = useList<any>("maintenance_logs", "date");
  const stock = useList<any>("stock_items");
  const pos = useList<any>("purchase_orders");
  const staticCosts = useList<any>("static_costs", "month");
  const mines = useList<any>("mines");
  const equipment = useList<any>("equipment");

  const stats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const prodMTD = (production.data ?? []).filter((p) => new Date(p.date) >= monthStart);
    const prodPrev = (production.data ?? []).filter((p) => {
      const d = new Date(p.date); return d >= prevStart && d < monthStart;
    });
    const tonsMTD = prodMTD.reduce((s, p) => s + Number(p.tons_produced), 0);
    const tonsPrev = prodPrev.reduce((s, p) => s + Number(p.tons_produced), 0);

    const maintMTD = (maint.data ?? []).filter((m) => new Date(m.date) >= monthStart);
    const maintSpend = maintMTD.reduce((s, m) => s + Number(m.total_cost), 0);
    const magMTD = prodMTD.reduce((s, p) => s + Number(p.magnetite_cost), 0);
    const otMTD = prodMTD.reduce((s, p) => s + Number(p.overtime_cost), 0);
    const staticMTD = (staticCosts.data ?? [])
      .filter((s) => new Date(s.month).getMonth() === now.getMonth() && new Date(s.month).getFullYear() === now.getFullYear())
      .reduce((s, c) => s + Number(c.amount), 0);
    const totalCostMTD = maintSpend + magMTD + otMTD + staticMTD;
    const rpt = tonsMTD > 0 ? totalCostMTD / tonsMTD : 0;

    const inventoryValue = (stock.data ?? []).reduce((s, i) => s + Number(i.qty_on_hand) * Number(i.unit_cost), 0);
    const lowStock = (stock.data ?? []).filter((i) => Number(i.qty_on_hand) <= Number(i.reorder_point));
    const draftPOs = (pos.data ?? []).filter((p) => p.status === "draft");
    const overdueMaint = (maint.data ?? []).filter((m) => m.next_due_date && new Date(m.next_due_date) < now);

    // cost breakdown pie
    const breakdown = [
      { name: "Static", value: staticMTD },
      { name: "Maintenance", value: maintSpend },
      { name: "Magnetite", value: magMTD },
      { name: "Overtime", value: otMTD },
    ].filter((x) => x.value > 0);

    // tons per mine (last 30d)
    const cutoff = new Date(now.getTime() - 30 * 86400000);
    const perMine = (mines.data ?? []).map((m) => {
      const tons = (production.data ?? [])
        .filter((p) => p.mine_id === m.id && new Date(p.date) >= cutoff)
        .reduce((s, p) => s + Number(p.tons_produced), 0);
      return { name: m.name, tons };
    });

    // cost/ton trend (last 6 months)
    const trend: { month: string; rpt: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const t = (production.data ?? []).filter((p) => { const pd = new Date(p.date); return pd >= d && pd < next; })
        .reduce((s, p) => s + Number(p.tons_produced), 0);
      const c = (production.data ?? []).filter((p) => { const pd = new Date(p.date); return pd >= d && pd < next; })
        .reduce((s, p) => s + Number(p.magnetite_cost) + Number(p.overtime_cost), 0)
        + (maint.data ?? []).filter((m) => { const md = new Date(m.date); return md >= d && md < next; })
          .reduce((s, m) => s + Number(m.total_cost), 0)
        + (staticCosts.data ?? []).filter((s) => { const sd = new Date(s.month); return sd.getMonth() === d.getMonth() && sd.getFullYear() === d.getFullYear(); })
          .reduce((s, x) => s + Number(x.amount), 0);
      trend.push({ month: d.toLocaleString("default", { month: "short" }), rpt: t > 0 ? Math.round(c / t) : 0 });
    }

    // Equipment life remaining
    const wear = (equipment.data ?? []).map((e) => {
      const pct = e.expected_life_tons ? Math.max(0, 100 - (Number(e.tons_since_install) / Number(e.expected_life_tons)) * 100) : null;
      return { name: e.name, pct };
    }).filter((x) => x.pct !== null).sort((a, b) => (a.pct! - b.pct!)).slice(0, 5);

    return {
      tonsMTD, tonsPrev, totalCostMTD, rpt, maintSpend, inventoryValue,
      lowStock, draftPOs, overdueMaint, breakdown, perMine, trend, wear,
    };
  }, [production.data, maint.data, stock.data, pos.data, staticCosts.data, mines.data, equipment.data]);

  const [drill, setDrill] = useState<null | "po" | "stock" | "maint">(null);
  const navigate = useNavigate();

  const trend = ((stats.tonsMTD - stats.tonsPrev) / (stats.tonsPrev || 1)) * 100;
  const CHART_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))"];
  // Recharts needs actual color values — use CSS var lookup via CSS colors
  const COLORS = ["#f59e0b", "#3b82f6", "#10b981", "#ef4444", "#8b5cf6"];

  return (
    <div>
      <PageHeader title="Dashboard" description="Operational overview across all mines and contracts." />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard to="/analytics" label="Rand / Ton (MTD)" value={ZAR(stats.rpt)} icon={<TrendingUp className="w-4 h-4" />} />
        <StatCard to="/production" label="Tonnes MTD" value={NUM(stats.tonsMTD)} sub={`${trend >= 0 ? "+" : ""}${trend.toFixed(1)}% vs last`} icon={<Fuel className="w-4 h-4" />} />
        <StatCard to="/maintenance" label="Maintenance MTD" value={ZAR(stats.maintSpend)} icon={<Wrench className="w-4 h-4" />} />
        <StatCard to="/inventory" label="Inventory Value" value={ZAR(stats.inventoryValue)} icon={<Boxes className="w-4 h-4" />} />
      </div>

      <div className="grid gap-4 md:grid-cols-3 mt-4">
        <AlertCard title="Draft POs awaiting approval" count={stats.draftPOs.length} tone="amber" onClick={() => setDrill("po")} />
        <AlertCard title="Low-stock items" count={stats.lowStock.length} tone="red" onClick={() => setDrill("stock")} />
        <AlertCard title="Overdue maintenance" count={stats.overdueMaint.length} tone="red" onClick={() => setDrill("maint")} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 mt-6">
        <Card>
          <CardHeader><CardTitle><Link to="/analytics" className="hover:text-primary transition-colors">Cost breakdown (MTD) →</Link></CardTitle></CardHeader>
          <CardContent style={{ height: 280 }}>
            {stats.breakdown.length === 0 ? <EmptyChart /> : (
              <ResponsiveContainer><PieChart>
                <Pie data={stats.breakdown} dataKey="value" nameKey="name" outerRadius={90} label>
                  {stats.breakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Legend /><Tooltip formatter={(v: any) => ZAR(v)} />
              </PieChart></ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle><Link to="/mines" className="hover:text-primary transition-colors">Tonnes per mine (30d) →</Link></CardTitle></CardHeader>
          <CardContent style={{ height: 280 }}>
            {stats.perMine.length === 0 ? <EmptyChart /> : (
              <ResponsiveContainer><BarChart data={stats.perMine}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" fontSize={11} /><YAxis fontSize={11} />
                <Tooltip formatter={(v: any) => NUM(v) + " t"} />
                <Bar dataKey="tons" fill={COLORS[0]} />
              </BarChart></ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 mt-4">
        <Card>
          <CardHeader><CardTitle><Link to="/analytics" className="hover:text-primary transition-colors">Cost per ton — 6 month trend →</Link></CardTitle></CardHeader>
          <CardContent style={{ height: 280 }}>
            <ResponsiveContainer><LineChart data={stats.trend}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="month" fontSize={11} /><YAxis fontSize={11} />
              <Tooltip formatter={(v: any) => ZAR(v)} />
              <Line type="monotone" dataKey="rpt" stroke={COLORS[1]} strokeWidth={2} />
            </LineChart></ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle><Link to="/equipment" className="hover:text-primary transition-colors">Equipment nearing end-of-life →</Link></CardTitle></CardHeader>
          <CardContent>
            {stats.wear.length === 0 ? <p className="text-sm text-muted-foreground">No equipment tracked yet.</p> : (
              <ul className="space-y-3">
                {stats.wear.map((w) => (
                  <li key={w.name} onClick={() => navigate({ to: "/equipment" })} className="flex items-center gap-3 cursor-pointer rounded-md p-1 -m-1 hover:bg-muted/50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{w.name}</div>
                      <div className="w-full h-2 bg-secondary rounded mt-1 overflow-hidden">
                        <div className="h-full" style={{ width: `${w.pct}%`, background: w.pct! < 20 ? "#ef4444" : w.pct! < 50 ? "#f59e0b" : "#10b981" }} />
                      </div>
                    </div>
                    <Badge variant={w.pct! < 20 ? "destructive" : "secondary"}>{Math.round(w.pct!)}%</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Sheet open={drill !== null} onOpenChange={(o) => !o && setDrill(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {drill === "po" ? "Draft purchase orders" : drill === "stock" ? "Low-stock items" : "Overdue maintenance"}
            </SheetTitle>
            <SheetDescription>
              {drill === "po" ? "Auto-drafted orders waiting for your approval." :
               drill === "stock" ? "At or below reorder point — these drive downtime." :
               "Services past their next due date."}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-2">
            {drill === "stock" && (stats.lowStock.length === 0
              ? <Empty text="Everything is above reorder point." />
              : stats.lowStock.map((i: any) => (
                <DrillRow key={i.id} title={i.name} sub={`On hand ${NUM(i.qty_on_hand)} ${i.unit} · reorder at ${NUM(i.reorder_point)}`} right={ZAR(Number(i.qty_on_hand) * Number(i.unit_cost))} />
              )))}

            {drill === "maint" && (stats.overdueMaint.length === 0
              ? <Empty text="No overdue services." />
              : stats.overdueMaint.map((m: any) => (
                <DrillRow key={m.id} title={equipment.data?.find((e: any) => e.id === m.equipment_id)?.name ?? m.description}
                  sub={`Due ${new Date(m.next_due_date).toLocaleDateString()} · ${m.description ?? ""}`} right={ZAR(m.total_cost)} />
              )))}

            {drill === "po" && (stats.draftPOs.length === 0
              ? <Empty text="No drafts pending." />
              : stats.draftPOs.map((p: any) => (
                <DrillRow key={p.id} title={p.po_number ?? `PO ${p.id.slice(0, 8)}`}
                  sub={`Created ${new Date(p.created_at).toLocaleDateString()}`} right={ZAR(p.total_cost ?? p.total ?? 0)} />
              )))}
          </div>

          <Button className="w-full mt-6" onClick={() => {
            const to = drill === "stock" ? "/inventory" : drill === "maint" ? "/maintenance" : "/purchase-orders";
            setDrill(null); navigate({ to });
          }}>
            Open full {drill === "stock" ? "inventory" : drill === "maint" ? "maintenance" : "purchase orders"}
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatCard({ label, value, sub, icon, to }: { label: string; value: string; sub?: string; icon?: React.ReactNode; to?: string }) {
  const card = (
    <Card className={to ? "cursor-pointer transition-all hover:border-primary/60 hover:shadow-lg hover:-translate-y-0.5" : undefined}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <div className="text-2xl font-bold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
  return to ? <Link to={to} className="block">{card}</Link> : card;
}

function AlertCard({ title, count, tone, onClick }: { title: string; count: number; tone: "amber" | "red"; onClick?: () => void }) {
  const color = count === 0 ? "text-muted-foreground" : tone === "red" ? "text-destructive" : "text-accent-foreground";
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } }}
      className="cursor-pointer transition-all hover:border-primary/60 hover:shadow-lg hover:-translate-y-0.5"
    >
      <CardContent className="p-4 flex items-center gap-3">
        <AlertTriangle className={`w-5 h-5 ${count === 0 ? "text-muted-foreground" : tone === "red" ? "text-destructive" : "text-accent"}`} />
        <div className="flex-1"><div className="text-sm font-medium">{title}</div></div>
        <div className={`text-2xl font-bold ${color}`}>{count}</div>
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

function DrillRow({ title, sub, right }: { title: string; sub?: string; right?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border p-3 bg-card">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{title}</div>
        {sub && <div className="text-xs text-muted-foreground truncate">{sub}</div>}
      </div>
      {right && <div className="text-sm font-semibold shrink-0">{right}</div>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-sm text-muted-foreground py-8 text-center border rounded-md">{text}</div>;
}

function EmptyChart() {
  return <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No data yet</div>;
}