import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";
import { useList, ZAR } from "@/lib/reef-db";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/NumberField";
import { Label } from "@/components/ui/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOneAtATime } from "@/hooks/useOneAtATime";
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

  const once = useOneAtATime();
  const submit = useMutation({
    mutationFn: async () => {
      if (!equipId && !label.trim()) throw new Error("Pick a vehicle or type a label");
      if (litres <= 0) throw new Error("Enter litres pumped");
      const photo_urls = photos ? await uploadPhotos(photos, "fuel") : [];
      // The total and who logged it are worked out on the server, so neither is sent.
      await api("/api/v1/fuel-slips", { method: "POST", body: JSON.stringify({
        equipment_id: equipId || null,
        mine_id: mineId || null,
        vehicle_label: label.trim() || null,
        litres,
        cost_per_litre: cpl,
        odometer: odo ? Number(odo) : null,
        photo_urls,
      }) });
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
        <Label htmlFor="log-fuel-vehicle-tool">Vehicle / tool</Label>
        <Select value={equipId} onValueChange={setEquipId}>
          <SelectTrigger id="log-fuel-vehicle-tool" className="h-12 text-base"><SelectValue placeholder="Select vehicle" /></SelectTrigger>
          <SelectContent>
            {equipment.data?.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input className="h-12" aria-label="Vehicle or tool not in the list" placeholder="Or type vehicle / tool name" value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="log-fuel-mine">Mine</Label>
        <Select value={mineId} onValueChange={setMineId}>
          <SelectTrigger id="log-fuel-mine" className="h-12 text-base"><SelectValue placeholder="Select mine" /></SelectTrigger>
          <SelectContent>
            {mines.data?.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
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
      <div className="space-y-2">
        <Label htmlFor="log-fuel-slip-photo" className="flex items-center gap-2"><Camera className="w-4 h-4" />Slip photo</Label>
        <Input id="log-fuel-slip-photo" type="file" accept="image/*" capture="environment" multiple className="h-12" onChange={(e) => setPhotos(e.target.files)} />
      </div>
      <Button className="w-full h-14 text-base" onClick={() => once(() => submit.mutateAsync()).catch(() => {})} disabled={submit.isPending}>
        {submit.isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}