import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useList, ZAR } from "@/lib/reef-db";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/NumberField";
import { Label } from "@/components/ui/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { uploadPhotos } from "@/lib/photo-upload";
import { Camera } from "lucide-react";

export const Route = createFileRoute("/worker/log-fuel")({ component: Page });

function Page() {
  const equipment = useList<any>("equipment", "name", true);
  const mines = useList<any>("mines", "name", true);
  const [equipId, setEquipId] = useState("");
  const [mineId, setMineId] = useState("");
  const [label, setLabel] = useState("");
  const [litres, setLitres] = useState<number>(0);
  const [cpl, setCpl] = useState<number>(0);
  const [odo, setOdo] = useState<string>("");
  const [photos, setPhotos] = useState<FileList | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const submit = useMutation({
    mutationFn: async () => {
      if (!equipId && !label.trim()) throw new Error("Pick a vehicle or type a label");
      if (litres <= 0) throw new Error("Enter litres pumped");
      const { data: userRes } = await supabase.auth.getUser();
      const photo_urls = photos ? await uploadPhotos(photos, "fuel") : [];
      const { error } = await supabase.from("fuel_slips").insert({
        equipment_id: equipId || null,
        mine_id: mineId || null,
        vehicle_label: label.trim() || null,
        litres,
        cost_per_litre: cpl,
        total_cost: Number((litres * cpl).toFixed(2)),
        odometer: odo ? Number(odo) : null,
        photo_urls,
        logged_by: userRes.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fuel_slips"] });
      toast.success("Fuel slip logged");
      navigate({ to: "/worker" });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Log Fuel Slip</h1>
      <div className="space-y-2">
        <Label>Vehicle / tool</Label>
        <Select value={equipId} onValueChange={setEquipId}>
          <SelectTrigger className="h-12 text-base"><SelectValue placeholder="Select vehicle" /></SelectTrigger>
          <SelectContent>
            {equipment.data?.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input className="h-12" placeholder="Or type vehicle / tool name" value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Mine</Label>
        <Select value={mineId} onValueChange={setMineId}>
          <SelectTrigger className="h-12 text-base"><SelectValue placeholder="Select mine" /></SelectTrigger>
          <SelectContent>
            {mines.data?.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Litres</Label>
          <NumberField step="0.01" className="h-12 text-lg" value={litres} onValueChange={setLitres} />
        </div>
        <div className="space-y-2">
          <Label>Rand / litre</Label>
          <NumberField step="0.01" className="h-12 text-lg" value={cpl} onValueChange={setCpl} />
        </div>
      </div>
      <div className="text-sm text-muted-foreground">Total: <span className="num-mono text-foreground">{ZAR(litres * cpl)}</span></div>
      <div className="space-y-2">
        <Label>Odometer / hour reading</Label>
        <Input type="number" inputMode="decimal" step="0.1" className="h-12 text-lg" value={odo} onChange={(e) => setOdo(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label className="flex items-center gap-2"><Camera className="w-4 h-4" />Slip photo</Label>
        <Input type="file" accept="image/*" capture="environment" multiple className="h-12" onChange={(e) => setPhotos(e.target.files)} />
      </div>
      <Button className="w-full h-14 text-base" onClick={() => submit.mutate()} disabled={submit.isPending}>
        {submit.isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}