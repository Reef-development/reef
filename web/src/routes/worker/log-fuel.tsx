import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";
import { useList, ZAR } from "@/lib/reef-db";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/NumberField";
import { Label } from "@/components/ui/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOneAtATime } from "@/hooks/useOneAtATime";
import { toast } from "sonner";
import { uploadPhotos } from "@/lib/photo-upload";
import { PhotoPicker } from "@/components/PhotoPicker";

export const Route = createFileRoute("/worker/log-fuel")({ component: Page });

type MyMine = { id: string; name: string } | null;

function Page() {
  // The worker's own mine: profiles.employee_id -> employees.mine_id -> mines.
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

  const equipment = useList<any>("equipment", "name", true);
  const [equipId, setEquipId] = useState("");
  const [label, setLabel] = useState("");
  const [litres, setLitres] = useState<number>(0);
  const [cpl, setCpl] = useState<number>(0);
  const [odo, setOdo] = useState<string>("");
  const [photos, setPhotos] = useState<File[]>([]);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const once = useOneAtATime();
  const submit = useMutation({
    mutationFn: async () => {
      const mine = myMine.data;
      if (!mine) {
        throw new Error(
          "Your account is not assigned to a mine. Ask your manager to set it before logging fuel.",
        );
      }
      if (!equipId && !label.trim()) throw new Error("Pick a vehicle or type a label");
      if (litres <= 0) throw new Error("Enter litres pumped");
      const photo_urls = photos.length ? await uploadPhotos(photos, "fuel") : [];
      // The total and who logged it are worked out on the server, so neither is sent.
      await api("/api/v1/fuel-slips", {
        method: "POST",
        body: JSON.stringify({
          equipment_id: equipId || null,
          mine_id: mine.id,
          vehicle_label: label.trim() || null,
          litres,
          cost_per_litre: cpl,
          odometer: odo ? Number(odo) : null,
          photo_urls,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fuel_slips"] });
      qc.invalidateQueries({ queryKey: ["my-mine"] });
      toast.success("Fuel slip logged");
      navigate({ to: "/worker" });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const mineLabel = myMine.isLoading
    ? "Loading…"
    : myMine.data?.name ?? "No mine assigned";

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Log Fuel Slip</h1>

      <div className="space-y-2">
        <Label htmlFor="log-fuel-mine">Mine</Label>
        <div
          id="log-fuel-mine"
          className="h-12 flex items-center px-3 rounded-md border border-input bg-secondary/40 text-base"
        >
          {mineLabel}
        </div>
        <p className="text-xs text-muted-foreground">
          This is the mine your account is assigned to. Ask your manager if it looks wrong.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="log-fuel-vehicle-tool">Vehicle / tool</Label>
        <Select value={equipId} onValueChange={setEquipId}>
          <SelectTrigger id="log-fuel-vehicle-tool" className="h-12 text-base"><SelectValue placeholder="Select vehicle" /></SelectTrigger>
          <SelectContent>
            {equipment.data?.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input className="h-12" aria-label="Vehicle or tool not in the list" placeholder="Or type vehicle / tool name" value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="log-fuel-litres">Litres</Label>
          <NumberField id="log-fuel-litres" step="0.01" className="h-12 text-lg" value={litres} onValueChange={setLitres} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="log-fuel-rand-litre">Rand / litre</Label>
          <NumberField id="log-fuel-rand-litre" step="0.01" className="h-12 text-lg" value={cpl} onValueChange={setCpl} />
        </div>
      </div>

      <div className="text-sm text-muted-foreground">Total: <span className="num-mono text-foreground">{ZAR(litres * cpl)}</span></div>

      <div className="space-y-2">
        <Label htmlFor="log-fuel-odometer-hour-reading">Odometer / hour reading</Label>
        <Input id="log-fuel-odometer-hour-reading" type="number" inputMode="decimal" step="0.1" className="h-12 text-lg" value={odo} onChange={(e) => setOdo(e.target.value)} />
      </div>

      <PhotoPicker id="log-fuel-slip-photo" label="Slip photo" files={photos} onChange={setPhotos} />

      <Button
        className="w-full h-14 text-base"
        onClick={() => once(() => submit.mutateAsync()).catch(() => {})}
        disabled={submit.isPending || myMine.isLoading || !myMine.data}
      >
        {submit.isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}