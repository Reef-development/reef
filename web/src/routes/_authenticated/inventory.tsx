import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useList, ZAR, NUM } from "@/lib/reef-db";
import { api, ApiRequestError, fetchMe } from "@/lib/api";
import { STOCK_KEY, isLow, useStockOnHand, type StockItem, type StockOnHand } from "@/hooks/useStock";
import { useOneAtATime } from "@/hooks/useOneAtATime";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { Field } from "@/components/ResourceDialog";
import { ReasonField, useChangeReason } from "@/components/ReasonField";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMemo, useState, type FormEvent } from "react";
import { Plus, AlertTriangle, SearchX } from "lucide-react";
import { toast } from "sonner";

/** `?item=<id>` opens one item, for links from elsewhere (a repair, a purchase order). */
export const Route = createFileRoute("/_authenticated/inventory")({
  component: Page,
  validateSearch: (search: Record<string, unknown>): { item?: string } =>
    typeof search.item === "string" ? { item: search.item } : {},
});

const ALL_PLANTS = "all";
export const NOT_AT_YOUR_PLANT = "That stock item doesn't exist, or it isn't at your plant.";

function Page() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { item: linkedId } = useSearch({ strict: false }) as { item?: string };
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 60_000 });
  const stock = useStockOnHand();
  const suppliers = useList<any>("suppliers", "name", true);
  const isOwner = me.data?.role === "owner";

  const [editing, setEditing] = useState<StockOnHand | null>(null);
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [plantFilter, setPlantFilter] = useState(ALL_PLANTS);

  // An item opened from a link. A 404 means it does not exist or is at another plant; the API
  // gives the same answer for both, so the screen cannot tell them apart either.
  const linked = useQuery({
    queryKey: [...STOCK_KEY, "item", linkedId],
    enabled: !!linkedId,
    retry: false,
    queryFn: async () => (await api<StockItem>(`/api/v1/stock/${linkedId}`)).data,
  });
  const linkedNotFound = linked.error instanceof ApiRequestError && linked.error.code === "NOT_FOUND";

  // The owner's plant choices come from the rows the API returned. This only narrows what is on
  // screen; which plants a person may see at all is decided by the API.
  const plants = useMemo(
    () => [...new Set((stock.data ?? []).map((s) => s.plant))].sort(),
    [stock.data],
  );
  const shown = useMemo(
    () =>
      isOwner && plantFilter !== ALL_PLANTS
        ? (stock.data ?? []).filter((s) => s.plant === plantFilter)
        : (stock.data ?? []),
    [stock.data, isOwner, plantFilter],
  );

  const openNew = () => { setEditing(null); setSupplierId(""); setOpen(true); };
  const openEdit = (r: StockOnHand) => { setEditing(r); setSupplierId(r.supplier_id ?? ""); setOpen(true); };

  const reason = useChangeReason();
  const save = useMutation({
    mutationFn: async ({ f, why }: { f: FormData; why: string | null }) => {
      const catalogue = {
        name: f.get("name"),
        sku: f.get("sku") || null,
        unit: f.get("unit") || "unit",
        unit_cost: Number(f.get("unit_cost") || 0),
        supplier_id: supplierId || null,
      };
      const levels = {
        qty_on_hand: Number(f.get("qty_on_hand") || 0),
        reorder_point: Number(f.get("reorder_point") || 0),
        reorder_qty: Number(f.get("reorder_qty") || 0),
      };
      if (editing) {
        await api(`/api/v1/stock/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify({ ...catalogue, version: editing.version, reason: why }),
        });
        if (editing.level) {
          await api(`/api/v1/stock-levels/${editing.level.id}`, {
            method: "PATCH",
            body: JSON.stringify({ ...levels, version: editing.level.version, reason: why }),
          });
        } else {
          await api("/api/v1/stock-levels", {
            method: "POST",
            body: JSON.stringify({ stock_item_id: editing.id, plant: editing.plant, ...levels }),
          });
        }
        return;
      }
      // The owner names the plant. Anyone else's plant is set by the API from their profile,
      // whatever is sent, so the screen sends their own and offers no choice.
      const plant = isOwner ? String(f.get("plant") ?? "").trim() : (me.data?.plant ?? "");
      const created = await api<StockItem>("/api/v1/stock", {
        method: "POST",
        body: JSON.stringify({ ...catalogue, plant }),
      });
      await api("/api/v1/stock-levels", {
        method: "POST",
        body: JSON.stringify({ stock_item_id: created.data.id, plant: created.data.plant, ...levels }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: STOCK_KEY });
      toast.success("Saved");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message || "Save failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/v1/stock/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: STOCK_KEY }); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message || "Delete failed"),
  });

  const once = useOneAtATime();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void once(async () => {
      // Changing a stock item needs a reason, which the history keeps (T6, T7). Adding one does not.
      const why = editing ? await reason.confirm() : null;
      if (editing && why === null) return;
      await save.mutateAsync({ f, why });
    }).catch(() => {});
  };

  const supplierName = (id: string | null) => suppliers.data?.find((s) => s.id === id)?.name ?? "—";

  return (
    <div>
      <PageHeader title="Inventory" description="Stock items with reorder thresholds. Draft POs are created automatically when qty falls at or below the reorder point." actions={
        <Button onClick={openNew}><Plus className="w-4 h-4 mr-1" />New stock item</Button>
      } />

      {linkedNotFound && (
        <Alert className="mb-4">
          <SearchX className="h-4 w-4" />
          <AlertTitle>Not found</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {NOT_AT_YOUR_PLANT}
            <Button variant="outline" size="sm" onClick={() => navigate({ to: ".", search: {} })}>Show all stock</Button>
          </AlertDescription>
        </Alert>
      )}

      {isOwner && (
        <div className="mb-4 max-w-xs">
          <Field label="Plant">
            <Select value={plantFilter} onValueChange={setPlantFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PLANTS}>All plants</SelectItem>
                {plants.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit stock item" : "New stock item"}</DialogTitle></DialogHeader>
          <form onSubmit={onSubmit} className="space-y-3">
            <Field label="Name"><Input name="name" required defaultValue={editing?.name} /></Field>
            {isOwner && !editing && (
              <Field label="Plant"><Input name="plant" required list="known-plants" placeholder="e.g. Kriel" /></Field>
            )}
            <datalist id="known-plants">{plants.map((p) => <option key={p} value={p} />)}</datalist>
            <div className="grid grid-cols-2 gap-3">
              <Field label="SKU"><Input name="sku" defaultValue={editing?.sku ?? ""} /></Field>
              <Field label="Unit"><Input name="unit" defaultValue={editing?.unit ?? "unit"} /></Field>
            </div>
            <Field label="Supplier">
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>{suppliers.data?.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Qty on hand"><Input name="qty_on_hand" type="number" step="0.01" defaultValue={editing?.qty_on_hand ?? ""} placeholder="0" /></Field>
              <Field label="Reorder point"><Input name="reorder_point" type="number" step="0.01" defaultValue={editing?.reorder_point ?? ""} placeholder="0" /></Field>
              <Field label="Reorder qty"><Input name="reorder_qty" type="number" step="0.01" defaultValue={editing?.reorder_qty ?? ""} placeholder="0" /></Field>
            </div>
            <Field label="Unit cost (ZAR)"><Input name="unit_cost" type="number" step="0.01" defaultValue={editing?.unit_cost ?? ""} placeholder="0" /></Field>
            {editing && <ReasonField reason={reason} />}
            <Button type="submit" className="w-full" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
          </form>
        </DialogContent>
      </Dialog>

      <DataTable
        rows={shown}
        empty={stock.isLoading ? "Loading stock…" : "No stock items yet."}
        columns={[
          { key: "name", label: "Item" },
          ...(isOwner ? [{ key: "plant", label: "Plant" }] : []),
          { key: "sku", label: "SKU" },
          { key: "qty", label: "On hand", render: (r: StockOnHand) => <span className={isLow(r) ? "text-destructive font-medium" : ""}>{NUM(r.qty_on_hand)} {r.unit}</span> },
          { key: "reorder", label: "Reorder at", render: (r: StockOnHand) => `${NUM(r.reorder_point)} → ${NUM(r.reorder_qty)}` },
          { key: "cost", label: "Unit cost", render: (r: StockOnHand) => ZAR(r.unit_cost) },
          { key: "supplier", label: "Supplier", render: (r: StockOnHand) => supplierName(r.supplier_id) },
          { key: "status", label: "Status", render: (r: StockOnHand) => isLow(r) ? <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" />Low</Badge> : null },
        ]}
        onEdit={openEdit}
        onDelete={(r) => remove.mutate(r.id)}
      />
    </div>
  );
}
