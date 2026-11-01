import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useList } from "@/lib/reef-db";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NumberField } from "@/components/NumberField";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOneAtATime } from "@/hooks/useOneAtATime";
import { toast } from "sonner";
import { uploadPhotos } from "@/lib/photo-upload";
import { PhotoPicker } from "@/components/PhotoPicker";

export const Route = createFileRoute("/worker/log-downtime")({ component: Page });

const REASONS = [
  { v: "breakdown", l: "Breakdown" },
  { v: "no_stock", l: "No stock" },
  { v: "waiting_on_part", l: "Waiting on part" },
  { v: "planned_maintenance", l: "Planned maintenance" },
  { v: "other", l: "Other" },
];

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

  const equipment = useList<any>("equipment", "name", true);
  const [equipId, setEquipId] = useState("");
  const [reason, setReason] = useState("breakdown");
  const [hours, setHours] = useState<number>(1);
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const once = useOneAtATime();
  const submit = useMutation({
    mutationFn: async () => {
      const mine = myMine.data;
      if (!mine) {
        throw new Error(
          "Your account is not assigned to a mine. Ask your manager to set it before logging downtime.",
        );
      }
      const { data: userRes } = await supabase.auth.getUser();
      const photo_urls = photos.length ? await uploadPhotos(photos, "downtime") : [];
      const { error } = await supabase.from("downtime_events").insert({
        mine_id: mine.id,
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
      qc.invalidateQueries({ queryKey: ["my-mine"] });
      toast.success("Downtime logged");
      navigate({ to: "/worker" });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const mineLabel = myMine.isLoading
    ? "Loading…"
    : myMine.data?.name ?? "No mine assigned";

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Log Downtime</h1>

      <div className="space-y-2">
        <Label htmlFor="log-downtime-mine">Mine</Label>
        <div
          id="log-downtime-mine"
          className="h-12 flex items-center px-3 rounded-md border border-input bg-secondary/40 text-base"
        >
          {mineLabel}
        </div>
        <p className="text-xs text-muted-foreground">
          This is the mine your account is assigned to. Ask your manager if it looks wrong.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="log-downtime-reason">Reason</Label>
        <Select value={reason} onValueChange={setReason}>
          <SelectTrigger id="log-downtime-reason" className="h-12 text-base"><SelectValue /></SelectTrigger>
          <SelectContent>{REASONS.map((r) => <SelectItem key={r.v} value={r.v}>{r.l}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="log-downtime-equipment-optional">Equipment (optional)</Label>
        <Select value={equipId} onValueChange={setEquipId}>
          <SelectTrigger id="log-downtime-equipment-optional" className="h-12 text-base"><SelectValue placeholder="Optional" /></SelectTrigger>
          <SelectContent>{equipment.data?.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="log-downtime-duration-hours">Duration (hours)</Label>
        <NumberField id="log-downtime-duration-hours" step="0.25" className="h-12 text-lg" value={hours} onValueChange={setHours} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="log-downtime-notes-optional">Notes (optional)</Label>
        <Textarea id="log-downtime-notes-optional" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <PhotoPicker id="log-downtime-photos-optional" label="Photos (optional)" files={photos} onChange={setPhotos} />

      <Button
        className="w-full h-14 text-base"
        onClick={() => once(() => submit.mutateAsync()).catch(() => {})}
        disabled={submit.isPending || myMine.isLoading || !myMine.data}
      >
        {submit.isPending ? "Saving…" : "Save Downtime"}
      </Button>
    </div>
  );
}