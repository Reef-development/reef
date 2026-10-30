import { createFileRoute } from "@tanstack/react-router";
import { useList, ZAR, NUM } from "@/lib/reef-db";
import { api, apiListAll } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Ban, Check, CheckCircle2, PackageCheck, Send } from "lucide-react";
import { toast } from "sonner";
import type { PurchaseOrder, PurchaseOrderStatus } from "@reef/shared";

export const Route = createFileRoute("/_authenticated/purchase-orders")({ component: Page });

type Verb = "approve" | "order" | "receive" | "cancel";

const FILTERS: { value: "all" | PurchaseOrderStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "ordered", label: "Ordered" },
  { value: "received", label: "Received" },
  { value: "cancelled", label: "Cancelled" },
];

const STEPS: { status: PurchaseOrderStatus; label: string; stamp?: "approved_at" | "ordered_at" | "received_at" }[] = [
  { status: "draft", label: "Draft" },
  { status: "approved", label: "Approved", stamp: "approved_at" },
  { status: "ordered", label: "Ordered", stamp: "ordered_at" },
  { status: "received", label: "Received", stamp: "received_at" },
];

const DONE_MESSAGE: Record<Verb, string> = {
  approve: "Order approved",
  order: "Marked as ordered",
  receive: "Received — stock updated",
  cancel: "Order cancelled",
};

/** Orders have no human number in the database, so the start of the id stands in for one. */
const poNumber = (po: Pick<PurchaseOrder, "id"> & { po_number?: string | null }) =>
  po.po_number || `PO-${po.id.slice(0, 6).toUpperCase()}`;

const statusClass = (s: string) =>
  s === "draft" ? "bg-muted text-muted-foreground border-transparent"
  : s === "approved" ? "bg-blue-100 text-blue-800 border-transparent dark:bg-blue-950 dark:text-blue-200"
  : s === "ordered" ? "bg-amber-100 text-amber-800 border-transparent dark:bg-amber-950 dark:text-amber-200"
  : s === "received" ? "bg-green-100 text-green-800 border-transparent dark:bg-green-950 dark:text-green-200"
  : "bg-red-100 text-red-800 border-transparent dark:bg-red-950 dark:text-red-200";

function StatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={`capitalize ${statusClass(status)}`}>{status}</Badge>;
}

function Page() {
  const orders = useQuery({
    queryKey: ["purchase_orders", "api"],
    queryFn: () => apiListAll<PurchaseOrder>("/api/v1/purchase-orders", { sort: "created_at", order: "desc", pageSize: 200 }),
  });
  const suppliers = useList<any>("suppliers", "name", true);
  const qc = useQueryClient();
  const [openPO, setOpenPO] = useState<PurchaseOrder | null>(null);
  const [filter, setFilter] = useState<"all" | PurchaseOrderStatus>("all");
  const [confirm, setConfirm] = useState<Verb | null>(null);
  const [reason, setReason] = useState("");

  const supplierName = (id: string | null) => suppliers.data?.find((s) => s.id === id)?.name ?? "No supplier";
  const rows = orders.data ?? [];
  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const countOf = (f: string) => (f === "all" ? rows.length : rows.filter((r) => r.status === f).length);

  const lines = useQuery({
    queryKey: ["po_lines", openPO?.id],
    enabled: !!openPO,
    queryFn: async () => {
      const { data, error } = await supabase.from("po_lines").select("*, stock_items(name, unit)").eq("po_id", openPO!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const close = () => {
    setOpenPO(null);
    setConfirm(null);
    setReason("");
  };

  const step = useMutation({
    mutationFn: async ({ id, verb, reason }: { id: string; verb: Verb; reason?: string }) => {
      const res = await api<PurchaseOrder>(`/api/v1/purchase-orders/${id}/${verb}`, {
        method: "POST",
        body: JSON.stringify(reason ? { reason } : {}),
      });
      return res.data;
    },
    onSuccess: (order, v) => {
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      qc.invalidateQueries({ queryKey: ["stock_items"] });
      qc.invalidateQueries({ queryKey: ["stock_levels"] });
      toast.success(DONE_MESSAGE[v.verb]);
      setOpenPO((cur) => (cur && order ? { ...cur, ...order } : cur));
      setConfirm(null);
      setReason("");
    },
    onError: (e: any) => toast.error(e.message ?? "That change was refused"),
  });

  const run = (verb: Verb) => openPO && step.mutate({ id: openPO.id, verb, reason: reason.trim() || undefined });
  const hasLines = (lines.data ?? []).length > 0;
  const status = openPO?.status;
  const canCancel = status === "draft" || status === "approved" || status === "ordered";
  const stepIndex = STEPS.findIndex((s) => s.status === status);

  const askCancel = confirm === "cancel";
  const askReceive = confirm === "receive";

  return (
    <div>
      <PageHeader title="Purchase Orders" description="Auto-drafted when stock falls at or below reorder point. Open an order to approve it, mark it ordered, receive the delivery or cancel it." />

      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((f) => (
          <Button key={f.value} size="sm" variant={filter === f.value ? "default" : "outline"} onClick={() => setFilter(f.value)}>
            {f.label} <span className="ml-1.5 opacity-70">{countOf(f.value)}</span>
          </Button>
        ))}
      </div>

      <DataTable rows={shown} columns={[
        { key: "po_number", label: "PO #", render: (r: any) => <span className="font-mono text-xs">{poNumber(r)}</span> },
        { key: "supplier", label: "Supplier", render: (r: any) => supplierName(r.supplier_id) },
        { key: "created_at", label: "Created", render: (r: any) => new Date(r.created_at).toLocaleDateString() },
        { key: "total", label: "Total", render: (r: any) => ZAR(r.total_cost) },
        { key: "status", label: "Status", render: (r: any) => <StatusBadge status={r.status} /> },
        { key: "actions", label: "", render: (r: any) => (
          <Button size="sm" variant={r.status === "draft" || r.status === "approved" || r.status === "ordered" ? "default" : "ghost"} onClick={() => setOpenPO(r)}>
            {r.status === "draft" ? "Review" : r.status === "approved" || r.status === "ordered" ? "Manage" : "View"}
          </Button>
        ) },
      ]} />

      <Dialog open={!!openPO} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">{openPO && poNumber(openPO)} {openPO && <StatusBadge status={openPO.status} />}</DialogTitle>
            <DialogDescription>{openPO && `${supplierName(openPO.supplier_id)} · ${openPO.plant}`}</DialogDescription>
          </DialogHeader>
          {openPO && (
            <div className="space-y-4">
              {status === "cancelled" ? (
                <div className="rounded-md bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200 text-sm p-3 flex items-center gap-2">
                  <Ban className="w-4 h-4 shrink-0" />This order was cancelled and can't be changed.
                </div>
              ) : (
                <ol className="grid grid-cols-4 gap-1 text-center text-xs">
                  {STEPS.map((s, i) => {
                    const reached = i <= stepIndex;
                    const when = s.stamp ? openPO[s.stamp] : openPO.created_at;
                    return (
                      <li key={s.status} className="space-y-1">
                        <div className={`mx-auto w-7 h-7 rounded-full flex items-center justify-center border ${reached ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground"}`}>
                          {reached ? <Check className="w-4 h-4" /> : i + 1}
                        </div>
                        <div className={reached ? "font-medium" : "text-muted-foreground"}>{s.label}</div>
                        <div className="text-muted-foreground">{reached && when ? new Date(when).toLocaleDateString() : " "}</div>
                      </li>
                    );
                  })}
                </ol>
              )}

              <div className="border rounded-md overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50"><tr><th className="text-left p-2">Item</th><th className="text-right p-2">Qty</th><th className="text-right p-2">Unit</th><th className="text-right p-2">Line total</th></tr></thead>
                  <tbody>
                    {(lines.data ?? []).map((l: any) => (
                      <tr key={l.id} className="border-t">
                        <td className="p-2">{l.stock_items?.name ?? "—"}</td>
                        <td className="p-2 text-right whitespace-nowrap">{NUM(l.qty)} {l.stock_items?.unit}</td>
                        <td className="p-2 text-right">{ZAR(l.unit_cost)}</td>
                        <td className="p-2 text-right">{ZAR(l.line_total ?? Number(l.qty) * Number(l.unit_cost))}</td>
                      </tr>
                    ))}
                    {!lines.isLoading && !hasLines && <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">No lines on this order</td></tr>}
                  </tbody>
                  <tfoot><tr className="border-t bg-muted/30 font-medium"><td className="p-2" colSpan={3}>Total</td><td className="p-2 text-right">{ZAR(openPO.total_cost)}</td></tr></tfoot>
                </table>
              </div>
              {openPO.notes && <p className="text-sm text-muted-foreground">{openPO.notes}</p>}

              {askCancel && (
                <div className="space-y-2 rounded-md border border-destructive/40 p-3">
                  <div className="text-sm font-medium">Why is this order being cancelled?</div>
                  <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Supplier can't deliver, ordered elsewhere" maxLength={500} />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => { setConfirm(null); setReason(""); }}>Keep order</Button>
                    <Button variant="destructive" disabled={!reason.trim() || step.isPending} onClick={() => run("cancel")}>Cancel this order</Button>
                  </div>
                </div>
              )}

              {askReceive && (
                <div className="space-y-2 rounded-md border p-3">
                  <div className="text-sm">Mark the delivery as received? This adds the {(lines.data ?? []).length} line(s) above to stock and can't be undone.</div>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setConfirm(null)}>Not yet</Button>
                    <Button disabled={step.isPending} onClick={() => run("receive")}><PackageCheck className="w-4 h-4 mr-1" />Yes, receive</Button>
                  </div>
                </div>
              )}

              {!askCancel && !askReceive && (
                <div className="flex flex-wrap justify-end gap-2">
                  {canCancel && <Button variant="outline" className="text-destructive" onClick={() => setConfirm("cancel")}><Ban className="w-4 h-4 mr-1" />Cancel order</Button>}
                  {status === "draft" && (
                    <Button disabled={!hasLines || step.isPending} onClick={() => run("approve")} title={hasLines ? undefined : "Add lines before approving"}>
                      <CheckCircle2 className="w-4 h-4 mr-1" />Approve
                    </Button>
                  )}
                  {status === "approved" && (
                    <Button variant="outline" disabled={step.isPending} onClick={() => run("order")}><Send className="w-4 h-4 mr-1" />Mark as ordered</Button>
                  )}
                  {(status === "approved" || status === "ordered") && (
                    <Button disabled={step.isPending} onClick={() => setConfirm("receive")}><PackageCheck className="w-4 h-4 mr-1" />Mark received</Button>
                  )}
                  {status === "received" && <span className="text-sm text-muted-foreground self-center">Received {openPO.received_at ? new Date(openPO.received_at).toLocaleDateString() : ""} — stock was updated.</span>}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
