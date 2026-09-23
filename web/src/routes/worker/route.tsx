import { createFileRoute, Outlet, redirect, useNavigate, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut, ArrowLeft } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import reefLogo from "@/assets/reef-logo.png.asset.json";

export const Route = createFileRoute("/worker")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: WorkerLayout,
});

function WorkerLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="h-16 border-b flex items-center gap-2 px-3 sticky top-0 z-10" style={{ backgroundColor: "#0d1b2a" }}>
        <Link to="/worker" className="p-2 -ml-2 rounded hover:bg-white/10 text-white">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 flex justify-center">
          <img src={reefLogo.url} alt="R.E.E.F" className="h-9 w-auto" />
        </div>
        <Button variant="ghost" size="sm" onClick={signOut} className="text-white hover:bg-white/10 hover:text-white">
          <LogOut className="w-4 h-4" />
        </Button>
      </header>
      <main className="flex-1 p-4 max-w-lg w-full mx-auto">
        <Outlet />
      </main>
    </div>
  );
}