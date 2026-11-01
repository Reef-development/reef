import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Boxes,
  Wrench,
  AlertOctagon,
  Factory,
  Fuel,
  Receipt,
  MonitorSmartphone,
  ClipboardList, // Added for manager
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/worker/")({
  component: WorkerHome,
});

const tiles = [
  {
    to: "/worker/log-usage",
    label: "Log Usage",
    icon: Boxes,
    color: "bg-primary text-primary-foreground",
  },
  {
    to: "/worker/log-repair",
    label: "Log Repair",
    icon: Wrench,
    color: "bg-accent text-accent-foreground",
  },
  {
    to: "/worker/log-downtime",
    label: "Log Downtime",
    icon: AlertOctagon,
    color: "bg-destructive text-destructive-foreground",
  },
  {
    to: "/worker/log-production",
    label: "Log Production",
    icon: Factory,
    color: "bg-secondary text-secondary-foreground border",
  },
  {
    to: "/worker/log-fuel",
    label: "Log Fuel",
    icon: Fuel,
    color: "bg-secondary text-secondary-foreground border",
  },
  {
    to: "/worker/log-purchase",
    label: "Money I Spent",
    icon: Receipt,
    color: "bg-secondary text-secondary-foreground border",
  },
] as const;

function WorkerHome() {
  // 1. Fetch the user's role to conditionally show the manager tile
  const { data: role } = useQuery({
    queryKey: ["my-role"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", auth.user.id);
        
      const list = roles?.map(r => r.role) || [];
      if (list.includes("owner")) return "owner";
      if (list.includes("manager")) return "manager";
      return "worker";
    }
  });

  // 2. Build the tile list, adding attendance if manager
  const allTiles = [
    ...tiles,
    ...(role === "manager" ? [{
      to: "/manager/log-attendance",
      label: "Log Attendance",
      icon: ClipboardList,
      color: "bg-emerald-700 text-white border-emerald-800", // Distinct green color for manager
    }] as const : []),
  ];

  return (
    <div className="space-y-4 animate-fade-in-soft">
      <div className="py-4 animate-fade-up">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] tracking-[0.28em] uppercase text-muted-foreground mb-1">
              On-site · Live sync
            </div>

            <h1 className="text-display text-2xl sm:text-3xl font-normal">Log your shift.</h1>

            <p className="text-sm text-muted-foreground mt-1">
              One tap. Data hits the office instantly.
            </p>
          </div>

          <Link
            to="/worker/sessions"
            className="shrink-0 flex items-center gap-1.5 px-3 h-9 rounded-md border bg-background text-xs uppercase tracking-wider font-medium hover:bg-secondary transition-colors"
            aria-label="Active sign-ins"
          >
            <MonitorSmartphone className="w-3.5 h-3.5" />
            Sign-ins
          </Link>
        </div>

        <div className="mining-rule mt-3 opacity-60" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {allTiles.map((t, i) => (
          <Link
            key={t.to}
            to={t.to}
            style={{
              animationDelay: `${i * 70}ms`,
            }}
            className={`${t.color} reef-tile animate-scale-in-soft rounded-2xl p-4 sm:p-6 flex flex-col items-center justify-center gap-3 aspect-square shadow-lg active:scale-[0.96] hover:-translate-y-0.5 hover:shadow-xl transition-all duration-200 border border-white/10`}
          >
            <t.icon className="w-8 h-8 sm:w-10 sm:h-10" />

            <span className="text-sm sm:text-base font-semibold text-center leading-tight tracking-wider uppercase">
              {t.label}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}