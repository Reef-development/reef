import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";
import { useList } from "@/lib/reef-db";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/NumberField";
import { Label } from "@/components/ui/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOneAtATime } from "@/hooks/useOneAtATime";
import { toast } from "sonner";
import { uploadPhotos } from "@/lib/photo-upload";
import { Camera } from "lucide-react";

export const Route = createFileRoute("/worker/log-purchase")({ component: Page });

const CATEGORIES = ["Parts", "Fuel", "Consumables", "Tools", "Other"] as const;

function Page() {
  const mines = useList<any>("mines", "name", true);
  const [mineId, setMineId] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<FileList | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const once = useOneAtATime();
  const submit = useMutation({
    mutationFn: async () => {
      if (!description.trim()) throw new Error("Say what you bought");
      if (!category.trim()) throw new Error("Pick a category or type your own");
      if (amount <= 0) throw new Error("Enter the amount you paid");
      const receipt_urls = photos ? await uploadPhotos(photos, "receipts") : [];
      // The worker is the signed-in user; the API fills worker_id from the profile link.
      await api("/api/v1/worker-purchases", {
        method: "POST",
        body: JSON.stringify({
          mine_id: mineId || null,
          date,
          description: description.trim(),
          category: category.trim(),
          amount,
          receipt_urls,
          notes: notes.trim() || null,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["worker_purchases"] });
      toast.success("Claim submitted — you'll be paid at month end");
      navigate({ to: "/worker" });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to submit"),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Money I spent</h1>
      <p className="text-sm text-muted-foreground">
        Bought something for the site out of your own pocket? Record it here and you'll
        be paid back at month end.
      </p>

      <div className="space-y-2">
        <Label htmlFor="log-purchase-description">What did you buy?</Label>
        <Input
          id="log-purchase-description"
          className="h-12"
          placeholder="e.g. Two tyres from the shop in town"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label>Category</Label>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={
                "px-4 h-12 rounded-md text-sm font-medium border transition-colors " +
                (category === c
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-input hover:bg-secondary")
              }
            >
              {c}
            </button>
          ))}
        </div>
        <Input
          className="h-12"
          placeholder="Or type your own"
          aria-label="Category, or type your own"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="log-purchase-amount">How much did you pay?</Label>
        <NumberField
          id="log-purchase-amount"
          step="0.01"
          className="h-12 text-lg"
          value={amount}
          onValueChange={setAmount}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="log-purchase-date">Date</Label>
          <Input
            id="log-purchase-date"
            type="date"
            className="h-12"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="log-purchase-mine">Mine</Label>
          <Select value={mineId} onValueChange={setMineId}>
            <SelectTrigger id="log-purchase-mine" className="h-12 text-base">
              <SelectValue placeholder="Optional" />
            </SelectTrigger>
            <SelectContent>
              {mines.data?.map((m: any) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="log-purchase-notes">Notes</Label>
        <Input
          id="log-purchase-notes"
          className="h-12"
          placeholder="Optional"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="log-purchase-photo" className="flex items-center gap-2">
          <Camera className="w-4 h-4" />
          Receipt photo
        </Label>
        <Input
          id="log-purchase-photo"
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="h-12"
          onChange={(e) => setPhotos(e.target.files)}
        />
        <p className="text-xs text-muted-foreground">
          Optional — if you kept the slip, take a photo so the office can see it.
        </p>
      </div>

      <Button
        className="w-full h-14 text-base"
        onClick={() => once(() => submit.mutateAsync()).catch(() => {})}
        disabled={submit.isPending}
      >
        {submit.isPending ? "Sending…" : "Send claim"}
      </Button>
    </div>
  );
}