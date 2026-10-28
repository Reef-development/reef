import { createFileRoute } from "@tanstack/react-router";
import { useList, ZAR, NUM } from "@/lib/reef-db";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, PackageCheck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/purchase-orders")({ component: Page });

function Page() {
  const list = useList<any>("purchase_orders", "created_at");
  const suppliers = useList<any>("suppliers", "name", true);
  const qc = useQueryClient();
  const [openPO, setOpenPO] = useState<any>(null);

  const lines = useQuery({
    queryKey: ["po_lines", openPO?.id],
    enabled: !!openPO,
    queryFn: async () => {
      const { data, error } = await supabase.from("po_lines").select("*, stock_items(name, unit)").eq("po_id", openPO.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const patch: any = { status };
      if (status === "approved") patch.approved_at = new Date().toISOString();
      if (status === "received") patch.received_at = new Date().toISOString();
      const { error } = await supabase.from("purchase_orders").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      qc.invalidateQueries({ queryKey: ["stock_items"] });
      toast.success(v.status === "received" ? "Received — stock updated" : `Marked ${v.status}`);
      setOpenPO(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const statusColor = (s: string) => s === "draft" ? "secondary" : s === "approved" ? "default" : s === "received" ? "outline" : "destructive";

  return (
    <div>
      <PageHeader title="Purchase Orders" description="Auto-drafted when stock falls at or below reorder point. Approve to send, mark received to update stock." />
      <DataTable rows={list.data ?? []} columns={[
        { key: "po_number", label: "PO #" },
        { key: "supplier", label: "Supplier", render: (r: any) => suppliers.data?.find((s) => s.id === r.supplier_id)?.name ?? "—" },
        { key: "created_at", label: "Created", render: (r: any) => new Date(r.created_at).toLocaleDateString() },
        { key: "total", label: "Total", render: (r: any) => ZAR(r.total_cost) },
        { key: "status", label: "Status", render: (r: any) => <Badge variant={statusColor(r.status) as any}>{r.status}</Badge> },
        { key: "actions", label: "", render: (r: any) => (
          <Button size="sm" variant="ghost" onClick={() => setOpenPO(r)}>View</Button>
        ) },
      ]} />

      <Dialog open={!!openPO} onOpenChange={(o) => !o && setOpenPO(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{openPO?.po_number}</DialogTitle></DialogHeader>
          {openPO && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Supplier:</span> {suppliers.data?.find((s) => s.id === openPO.supplier_id)?.name ?? "—"}</div>
                <div><span className="text-muted-foreground">Total:</span> <b>{ZAR(openPO.total_cost)}</b></div>
                <div><span className="text-muted-foreground">Status:</span> <Badge variant={statusColor(openPO.status) as any}>{openPO.status}</Badge></div>
                <div><span className="text-muted-foreground">Created:</span> {new Date(openPO.created_at).toLocaleString()}</div>
              </div>
              <div className="border rounded-md">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50"><tr><th className="text-left p-2">Item</th><th className="text-right p-2">Qty</th><th className="text-right p-2">Unit</th><th className="text-right p-2">Line total</th></tr></thead>
                  <tbody>
                    {(lines.data ?? []).map((l: any) => (
                      <tr key={l.id} className="border-t">
                        <td className="p-2">{l.stock_items?.name ?? "—"}</td>
                        <td className="p-2 text-right">{NUM(l.qty)} {l.stock_items?.unit}</td>
                        <td className="p-2 text-right">{ZAR(l.unit_cost)}</td>
                        <td className="p-2 text-right">{ZAR(l.line_total)}</td>
                      </tr>
                    ))}
                    {(lines.data ?? []).length === 0 && <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">No lines</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-2">
                {openPO.status === "draft" && (
                  <>
                    <Button variant="outline" onClick={() => updateStatus.mutate({ id: openPO.id, status: "cancelled" })}>Cancel PO</Button>
                    <Button onClick={() => updateStatus.mutate({ id: openPO.id, status: "approved" })}>
                      <CheckCircle2 className="w-4 h-4 mr-1" />Approve
                    </Button>
                  </>
                )}
                {openPO.status === "approved" && (
                  <Button onClick={() => updateStatus.mutate({ id: openPO.id, status: "received" })}>
                    <PackageCheck className="w-4 h-4 mr-1" />Mark received
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}