import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";
import { NUM } from "@/lib/reef-db";
import { STOCK_KEY, useStockOnHand } from "@/hooks/useStock";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/NumberField";
import { Label } from "@/components/ui/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOneAtATime } from "@/hooks/useOneAtATime";
import { toast } from "sonner";

export const Route = createFileRoute("/worker/log-usage")({ component: Page });

function Page() {
  // Only the items at this person's plant: the API returns no others.
  const stock = useStockOnHand();
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState<number>(1);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const once = useOneAtATime();
  const submit = useMutation({
    mutationFn: async () => {
      if (!itemId) throw new Error("Select an item");
      if (qty <= 0) throw new Error("Enter a quantity");
      // One server-side step: the quantity comes off in the database, so two people recording at
      // once both count, and a reorder is drafted if the item runs low.
      await api("/api/v1/stock-usage", { method: "POST", body: JSON.stringify({ stock_item_id: itemId, qty }) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: STOCK_KEY });
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      toast.success("Usage logged");
      navigate({ to: "/worker" });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Log Stock Usage</h1>
      <div className="space-y-2">
        <Label htmlFor="log-usage-item">Item</Label>
        <Select value={itemId} onValueChange={setItemId}>
          <SelectTrigger id="log-usage-item" className="h-12 text-base"><SelectValue placeholder="Select item" /></SelectTrigger>
          <SelectContent>
            {stock.data?.map((s: any) => (
              <SelectItem key={s.id} value={s.id}>{s.name} · {NUM(s.qty_on_hand)} {s.unit ?? ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="log-usage-quantity-used">Quantity used</Label>
        <NumberField id="log-usage-quantity-used" step="0.01" className="h-12 text-lg" value={qty} onValueChange={setQty} />
      </div>
      <Button className="w-full h-14 text-base" onClick={() => once(() => submit.mutateAsync()).catch(() => {})} disabled={submit.isPending}>
        {submit.isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}