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
import { uploadPhotos } from "@/lib/photo-upload";
import { Camera } from "lucide-react";

export const Route = createFileRoute("/worker/log-repair")({ component: Page });

function Page() {
  const equipment = useList<any>("equipment", "name", true);
  const [equipId, setEquipId] = useState("");
  const [desc, setDesc] = useState("");
  const [cost, setCost] = useState<number>(0);
  const [photos, setPhotos] = useState<FileList | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const submit = useMutation({
    mutationFn: async () => {
      if (!equipId) throw new Error("Select equipment");
      if (!desc) throw new Error("Enter a description");
      const { data: userRes } = await supabase.auth.getUser();
      const photo_urls = photos ? await uploadPhotos(photos, "repairs") : [];
      const { error } = await supabase.from("maintenance_logs").insert({
        equipment_id: equipId,
        date: new Date().toISOString().slice(0, 10),
        description: desc,
        labour_cost: cost,
        photo_urls,
        logged_by: userRes.user?.id ?? null,
      });
      if (error) throw error;
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
        <Label>Equipment</Label>
        <Select value={equipId} onValueChange={setEquipId}>
          <SelectTrigger className="h-12 text-base"><SelectValue placeholder="Select equipment" /></SelectTrigger>
          <SelectContent>
            {equipment.data?.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>What happened</Label>
        <Input className="h-12 text-base" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Replaced belt on conveyor 2" />
      </div>
      <div className="space-y-2">
        <Label>Labour cost (ZAR)</Label>
        <NumberField step="0.01" className="h-12 text-lg" value={cost} onValueChange={setCost} />
      </div>
      <div className="space-y-2">
        <Label className="flex items-center gap-2"><Camera className="w-4 h-4" />Photos (optional)</Label>
        <Input type="file" accept="image/*" capture="environment" multiple onChange={(e) => setPhotos(e.target.files)} />
        {photos && <p className="text-xs text-muted-foreground">{photos.length} photo(s) selected</p>}
      </div>
      <Button className="w-full h-14 text-base" onClick={() => submit.mutate()} disabled={submit.isPending}>
        {submit.isPending ? "Saving…" : "Save Repair"}
      </Button>
    </div>
  );
}