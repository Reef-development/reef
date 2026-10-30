import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";
import { reefToday } from "@reef/shared";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/NumberField";
import { Label } from "@/components/ui/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOneAtATime } from "@/hooks/useOneAtATime";
import { toast } from "sonner";

export const Route = createFileRoute("/worker/log-production")({ component: Page });

type MyMine = { id: string; name: string } | null;

function Page() {
  // The worker's own mine: profiles.employee_id -> employees.mine_id -> mines.
  // Resolved from the signed-in session, never chosen by the worker.
  const myMine = useQuery<MyMine>({
    queryKey: ["my-mine"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return null;

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("employee_id")
        .eq("id", uid)
        .maybeSingle();
      if (profileError) throw profileError;
      const employeeId = (profile as { employee_id: string | null } | null)?.employee_id;
      if (!employeeId) return null;

      const { data: employee, error: employeeError } = await supabase
        .from("employees")
        .select("mine_id, mine:mines(id, name)")
        .eq("id", employeeId)
        .maybeSingle();
      if (employeeError) throw employeeError;

      const mine = (employee as { mine?: { id: string; name: string } | null } | null)?.mine;
      return mine ?? null;
    },
  });

  const [tons, setTons] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const once = useOneAtATime();
  const submit = useMutation({
    mutationFn: async () => {
      const mine = myMine.data;
      if (!mine) {
        throw new Error(
          "Your account is not assigned to a mine. Ask your manager to set it before logging production.",
        );
      }
      if (tons <= 0) throw new Error("Enter tons produced");
      await api("/api/v1/production-logs", {
        method: "POST",
        body: JSON.stringify({
          mine_id: mine.id,
          date: reefToday(),
          tons_produced: tons,
          notes: notes.trim() || null,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production_logs"] });
      qc.invalidateQueries({ queryKey: ["my-mine"] });
      toast.success("Production logged");
      navigate({ to: "/worker" });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const mineLabel = myMine.isLoading
    ? "Loading…"
    : myMine.data?.name ?? "No mine assigned";

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Log Production</h1>

      <div className="space-y-2">
        <Label htmlFor="log-production-mine">Mine</Label>
        <div
          id="log-production-mine"
          className="h-12 flex items-center px-3 rounded-md border border-input bg-secondary/40 text-base"
        >
          {mineLabel}
        </div>
        <p className="text-xs text-muted-foreground">
          This is the mine your account is assigned to. Ask your manager if it looks wrong.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="log-production-tons-produced">Tons produced</Label>
        <NumberField
          id="log-production-tons-produced"
          step="0.01"
          className="h-12 text-lg"
          value={tons}
          onValueChange={setTons}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="log-production-notes">Notes</Label>
        <Input
          id="log-production-notes"
          className="h-12"
          placeholder="Optional"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <Button
        className="w-full h-14 text-base"
        onClick={() => once(() => submit.mutateAsync()).catch(() => {})}
        disabled={submit.isPending || myMine.isLoading || !myMine.data}
      >
        {submit.isPending ? "Saving…" : "Save Production"}
      </Button>
    </div>
  );
}