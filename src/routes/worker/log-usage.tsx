import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useList, NUM } from "@/lib/reef-db";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/NumberField";
import { Label } from "@/components/ui/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const Route = createFileRoute("/worker/log-usage")({ component: Page });

function Page() {
  const stock = useList<any>("stock_items", "name", true);
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState<number>(1);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const submit = useMutation({
    mutationFn: async () => {
      if (!itemId) throw new Error("Select an item");
      if (qty <= 0) throw new Error("Enter a quantity");
      const item = stock.data?.find((s: any) => s.id === itemId);
      if (!item) throw new Error("Item not found");
      const newQty = Number(item.qty_on_hand) - qty;
      const { error } = await supabase.from("stock_items").update({ qty_on_hand: newQty }).eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_items"] });
      toast.success("Usage logged");
      navigate({ to: "/worker" });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Log Stock Usage</h1>
      <div className="space-y-2">
        <Label>Item</Label>
        <Select value={itemId} onValueChange={setItemId}>
          <SelectTrigger className="h-12 text-base"><SelectValue placeholder="Select item" /></SelectTrigger>
          <SelectContent>
            {stock.data?.map((s: any) => (
              <SelectItem key={s.id} value={s.id}>{s.name} · {NUM(s.qty_on_hand)} {s.unit ?? ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Quantity used</Label>
        <NumberField step="0.01" className="h-12 text-lg" value={qty} onValueChange={setQty} />
      </div>
      <Button className="w-full h-14 text-base" onClick={() => submit.mutate()} disabled={submit.isPending}>
        {submit.isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}