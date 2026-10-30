import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";
import { reefToday } from "@reef/shared";
import { useList } from "@/lib/reef-db";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/NumberField";
import { Label } from "@/components/ui/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOneAtATime } from "@/hooks/useOneAtATime";
import { toast } from "sonner";
import { uploadPhotos } from "@/lib/photo-upload";
import { PhotoPicker } from "@/components/PhotoPicker";

export const Route = createFileRoute("/worker/log-repair")({ component: Page });

function Page() {
  const equipment = useList<any>("equipment", "name", true);
  const [equipId, setEquipId] = useState("");
  const [desc, setDesc] = useState("");
  const [cost, setCost] = useState<number>(0);
  const [photos, setPhotos] = useState<File[]>([]);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const once = useOneAtATime();
  const submit = useMutation({
    mutationFn: async () => {
      if (!equipId) throw new Error("Select equipment");
      if (!desc) throw new Error("Enter a description");
      const photo_urls = photos.length ? await uploadPhotos(photos, "repairs") : [];
      // The API records who logged it from the sign-in, so the screen does not send it.
      await api("/api/v1/maintenance-logs", {
        method: "POST",
        body: JSON.stringify({
          equipment_id: equipId,
          date: reefToday(),
          description: desc,
          labour_cost: cost,
          photo_urls,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance_logs"] });
      toast.success("Repair logged");
      navigate({ to: "/worker" });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Log Repair</h1>
      <div className="space-y-2">
        <Label htmlFor="log-repair-equipment">Equipment</Label>
        <Select value={equipId} onValueChange={setEquipId}>
          <SelectTrigger id="log-repair-equipment" className="h-12 text-base"><SelectValue placeholder="Select equipment" /></SelectTrigger>
          <SelectContent>
            {equipment.data?.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="log-repair-what-happened">What happened</Label>
        <Input id="log-repair-what-happened" className="h-12 text-base" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Replaced belt on conveyor 2" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="log-repair-labour-cost-zar">Labour cost (ZAR)</Label>
        <NumberField id="log-repair-labour-cost-zar" step="0.01" className="h-12 text-lg" value={cost} onValueChange={setCost} />
      </div>
      <PhotoPicker id="log-repair-photos-optional" label="Photos (optional)" files={photos} onChange={setPhotos} />
      <Button className="w-full h-14 text-base" onClick={() => once(() => submit.mutateAsync()).catch(() => {})} disabled={submit.isPending}>
        {submit.isPending ? "Saving…" : "Save Repair"}
      </Button>
    </div>
  );
}