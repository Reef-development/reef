import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useList } from "@/lib/reef-db";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/NumberField";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { uploadPhotos } from "@/lib/photo-upload";
import { Camera } from "lucide-react";

export const Route = createFileRoute("/worker/log-downtime")({ component: Page });

const REASONS = [
  { v: "breakdown", l: "Breakdown" },
  { v: "no_stock", l: "No stock" },
  { v: "waiting_on_part", l: "Waiting on part" },
  { v: "planned_maintenance", l: "Planned maintenance" },
  { v: "other", l: "Other" },
];

function Page() {
  const mines = useList<any>("mines", "name", true);
  const equipment = useList<any>("equipment", "name", true);
  const [mineId, setMineId] = useState("");
  const [equipId, setEquipId] = useState("");
  const [reason, setReason] = useState("breakdown");
  const [hours, setHours] = useState<number>(1);
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<FileList | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const submit = useMutation({
    mutationFn: async () => {
      if (!mineId) throw new Error("Select mine");
      const { data: userRes } = await supabase.auth.getUser();
      const photo_urls = photos ? await uploadPhotos(photos, "downtime") : [];
      const { error } = await supabase.from("downtime_events").insert({
        mine_id: mineId,
        equipment_id: equipId || null,
        reason,
        duration_hours: hours,
        notes: notes || null,
        photo_urls,
        logged_by: userRes.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["downtime_events"] });
      toast.success("Downtime logged");
      navigate({ to: "/worker" });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Log Downtime</h1>
      <div className="space-y-2">
        <Label>Mine</Label>
        <Select value={mineId} onValueChange={setMineId}>
          <SelectTrigger className="h-12 text-base"><SelectValue placeholder="Select mine" /></SelectTrigger>
          <SelectContent>{mines.data?.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Reason</Label>
        <Select value={reason} onValueChange={setReason}>
          <SelectTrigger className="h-12 text-base"><SelectValue /></SelectTrigger>
          <SelectContent>{REASONS.map((r) => <SelectItem key={r.v} value={r.v}>{r.l}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Equipment (optional)</Label>
        <Select value={equipId} onValueChange={setEquipId}>
          <SelectTrigger className="h-12 text-base"><SelectValue placeholder="Optional" /></SelectTrigger>
          <SelectContent>{equipment.data?.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Duration (hours)</Label>
        <NumberField step="0.25" className="h-12 text-lg" value={hours} onValueChange={setHours} />
      </div>
      <div className="space-y-2">
        <Label>Notes (optional)</Label>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label className="flex items-center gap-2"><Camera className="w-4 h-4" />Photos (optional)</Label>
        <Input type="file" accept="image/*" capture="environment" multiple onChange={(e) => setPhotos(e.target.files)} />
        {photos && <p className="text-xs text-muted-foreground">{photos.length} photo(s) selected</p>}
      </div>
      <Button className="w-full h-14 text-base" onClick={() => submit.mutate()} disabled={submit.isPending}>
        {submit.isPending ? "Saving…" : "Save Downtime"}
      </Button>
    </div>
  );
}