import { createFileRoute, Link } from "@tanstack/react-router";
import { Boxes, Wrench, AlertOctagon, Fuel, Droplets } from "lucide-react";

export const Route = createFileRoute("/worker/")({
  component: WorkerHome,
});

const tiles = [
  { to: "/worker/log-usage", label: "Log Usage", icon: Boxes, color: "bg-primary text-primary-foreground" },
  { to: "/worker/log-repair", label: "Log Repair", icon: Wrench, color: "bg-accent text-accent-foreground" },
  { to: "/worker/log-downtime", label: "Log Downtime", icon: AlertOctagon, color: "bg-destructive text-destructive-foreground" },
  { to: "/worker/log-production", label: "Log Production", icon: Fuel, color: "bg-secondary text-secondary-foreground border" },
  { to: "/worker/log-fuel", label: "Log Fuel", icon: Droplets, color: "bg-secondary text-secondary-foreground border" },
] as const;

function WorkerHome() {
  return (
    <div className="space-y-4 animate-fade-in-soft">
      <div className="py-4 animate-fade-up">
        <div className="text-[10px] tracking-[0.28em] uppercase text-muted-foreground mb-1">On-site · Live sync</div>
        <h1 className="text-display text-2xl sm:text-3xl font-normal">Log your shift.</h1>
        <p className="text-sm text-muted-foreground mt-1">One tap. Data hits the office instantly.</p>
        <div className="mining-rule mt-3 opacity-60" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {tiles.map((t, i) => (
          <Link
            key={t.to}
            to={t.to}
            style={{ animationDelay: `${i * 70}ms` }}
            className={`${t.color} reef-tile animate-scale-in-soft rounded-2xl p-4 sm:p-6 flex flex-col items-center justify-center gap-3 aspect-square shadow-lg active:scale-[0.96] hover:-translate-y-0.5 hover:shadow-xl transition-all duration-200 border border-white/10`}
          >
            <t.icon className="w-8 h-8 sm:w-10 sm:h-10" />
            <span className="text-sm sm:text-base font-semibold text-center leading-tight tracking-wider uppercase">{t.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}