import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useList } from "@/lib/reef-db";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/NumberField";
import { Label } from "@/components/ui/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const Route = createFileRoute("/worker/log-production")({ component: Page });

function Page() {
  const mines = useList<any>("mines", "name", true);
  const [mineId, setMineId] = useState("");
  const [tons, setTons] = useState<number>(0);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const submit = useMutation({
    mutationFn: async () => {
      if (!mineId) throw new Error("Select mine");
      if (tons <= 0) throw new Error("Enter tons produced");
      const { error } = await supabase.from("production_logs").insert({
        mine_id: mineId,
        date: new Date().toISOString().slice(0, 10),
        tons_produced: tons,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production_logs"] });
      toast.success("Production logged");
      navigate({ to: "/worker" });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Log Production</h1>
      <div className="space-y-2">
        <Label>Mine</Label>
        <Select value={mineId} onValueChange={setMineId}>
          <SelectTrigger className="h-12 text-base"><SelectValue placeholder="Select mine" /></SelectTrigger>
          <SelectContent>{mines.data?.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Tons produced</Label>
        <NumberField step="0.01" className="h-12 text-lg" value={tons} onValueChange={setTons} />
      </div>
      <Button className="w-full h-14 text-base" onClick={() => submit.mutate()} disabled={submit.isPending}>
        {submit.isPending ? "Saving…" : "Save Production"}
      </Button>
    </div>
  );
}