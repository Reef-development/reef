import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useList, ZAR } from "@/lib/reef-db";
import { signedPhotoUrl } from "@/lib/photo-upload";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Banknote, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/reimbursements")({ component: Page });

type Purchase = {
  id: string;
  worker_id: string;
  mine_id: string | null;
  date: string;
  description: string;
  category: string;
  amount: number;
  status: "pending" | "paid" | "voided";
  paid_on: string | null;
  paid_by: string | null;
  voided_reason: string | null;
  receipt_urls: string[] | null;
  notes: string | null;
};

const STATUS_TABS = ["pending", "paid", "voided", "all"] as const;
type StatusTab = (typeof STATUS_TABS)[number];

function Page() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusTab>("pending");
  const [month, setMonth] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [viewPurchase, setViewPurchase] = useState<Purchase | null>(null);

  const employees = useList<any>("employees", "full_name", true);
  const employeeById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees.data ?? []) m.set(e.id, e.full_name);
    return m;
  }, [employees.data]);

  const purchases = useQuery({
    queryKey: ["worker_purchases", status, month],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("pageSize", "200");
      params.set("sort", "date");
      params.set("order", "desc");
      if (status !== "all") params.set("status", status);
      if (month) params.set("month", month);
      const res = await api<Purchase[]>(`/api/v1/worker-purchases?${params}`);
      return res.data;
    },
  });

  const rows = purchases.data ?? [];
  const pendingRows = rows.filter((r) => r.status === "pending");
  const pendingTotal = pendingRows.reduce((s, r) => s + Number(r.amount ?? 0), 0);

  const selectedRows = rows.filter((r) => selected.has(r.id) && r.status === "pending");
  const selectedTotal = selectedRows.reduce((s, r) => s + Number(r.amount ?? 0), 0);

  const byWorker = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of selectedRows) {
      const name = employeeById.get(r.worker_id) ?? "Unknown";
      map.set(name, (map.get(name) ?? 0) + Number(r.amount ?? 0));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [selectedRows, employeeById]);

  // The first receipt on the open claim, resolved to a one-hour signed URL.
  const firstReceiptPath = viewPurchase?.receipt_urls?.[0] ?? null;
  const receiptUrl = useQuery({
    queryKey: ["receipt", firstReceiptPath],
    enabled: !!firstReceiptPath,
    queryFn: () => signedPhotoUrl(firstReceiptPath!),
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (pendingRows.every((r) => selected.has(r.id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pendingRows.map((r) => r.id)));
    }
  };

  const markPaid = useMutation({
    mutationFn: async (ids: string[]) => {
      await api("/api/v1/worker-purchases/mark-paid", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["worker_purchases"] });
      toast.success(
        `${selectedRows.length} claim${selectedRows.length === 1 ? "" : "s"} marked paid`,
      );
      setSelected(new Set());
      setConfirmOpen(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const markOnePaid = useMutation({
    mutationFn: async (id: string) => {
      await api(`/api/v1/worker-purchases/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "paid" }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["worker_purchases"] });
      toast.success("Marked paid");
      setViewPurchase(null);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const statusVariant = (s: string) =>
    s === "pending" ? "secondary" : s === "paid" ? "default" : "destructive";

  return (
    <div>
      <PageHeader
        title="Reimbursements"
        description="Money workers spent out of pocket. Mark claims paid at month end."
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex border rounded-md overflow-hidden">
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setStatus(s);
                setSelected(new Set());
              }}
              className={
                "px-3 h-9 text-xs uppercase tracking-wider font-medium transition-colors " +
                (status === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-secondary")
              }
            >
              {s}
            </button>
          ))}
        </div>

        <input
          type="month"
          value={month}
          onChange={(e) => {
            setMonth(e.target.value);
            setSelected(new Set());
          }}
          className="h-9 px-3 text-sm rounded-md border bg-background"
        />

        {month && (
          <Button variant="ghost" size="sm" onClick={() => setMonth("")}>
            Clear month
          </Button>
        )}

        <div className="ml-auto flex items-center gap-3">
          {pendingRows.length > 0 && (
            <span className="text-sm text-muted-foreground">
              <span className="num-mono text-foreground font-medium">{ZAR(pendingTotal)}</span>{" "}
              outstanding across {pendingRows.length}{" "}
              {pendingRows.length === 1 ? "claim" : "claims"}
            </span>
          )}
          {selectedRows.length > 0 && (
            <Button size="sm" onClick={() => setConfirmOpen(true)}>
              <Banknote className="w-4 h-4 mr-1" />
              Mark {selectedRows.length} as paid
            </Button>
          )}
        </div>
      </div>

      {purchases.isLoading && (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
      )}

      {!purchases.isLoading && rows.length === 0 && (
        <div className="text-sm text-muted-foreground py-12 text-center border rounded-md">
          No claims to show.
        </div>
      )}

      {rows.length > 0 && (
        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="w-10 p-3">
                  {status === "pending" && pendingRows.length > 0 && (
                    <Checkbox
                      checked={pendingRows.every((r) => selected.has(r.id))}
                      onCheckedChange={toggleAll}
                      aria-label="Select all pending"
                    />
                  )}
                </th>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Worker</th>
                <th className="text-left p-3">Description</th>
                <th className="text-left p-3">Category</th>
                <th className="text-right p-3">Amount</th>
                <th className="text-left p-3">Status</th>
                <th className="w-20 p-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/20">
                  <td className="p-3">
                    {r.status === "pending" && (
                      <Checkbox
                        checked={selected.has(r.id)}
                        onCheckedChange={() => toggle(r.id)}
                        aria-label={`Select claim ${r.id}`}
                      />
                    )}
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {new Date(r.date).toLocaleDateString("en-ZA")}
                  </td>
                  <td className="p-3">{employeeById.get(r.worker_id) ?? "—"}</td>
                  <td className="p-3">{r.description}</td>
                  <td className="p-3 text-muted-foreground">{r.category}</td>
                  <td className="p-3 text-right num-mono">{ZAR(r.amount)}</td>
                  <td className="p-3">
                    <Badge variant={statusVariant(r.status) as any}>{r.status}</Badge>
                  </td>
                  <td className="p-3">
                    <Button size="sm" variant="ghost" onClick={() => setViewPurchase(r)}>
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm batch mark-paid */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Mark these claims as paid?</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                {selectedRows.length} {selectedRows.length === 1 ? "claim" : "claims"}
              </div>
              <div className="max-h-80 overflow-y-auto border rounded-md divide-y">
                {selectedRows.map((r) => (
                  <div key={r.id} className="flex justify-between items-center p-3 text-sm">
                    <div className="min-w-0">
                      <div className="truncate">{r.description}</div>
                      <div className="text-xs text-muted-foreground">
                        {employeeById.get(r.worker_id) ?? "—"} ·{" "}
                        {new Date(r.date).toLocaleDateString("en-ZA")}
                      </div>
                    </div>
                    <div className="num-mono ml-3 shrink-0">{ZAR(r.amount)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Total
              </div>
              <div className="border rounded-md p-4 mb-4">
                <div className="text-3xl num-mono">{ZAR(selectedTotal)}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {selectedRows.length} {selectedRows.length === 1 ? "claim" : "claims"}
                </div>
              </div>

              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                By worker
              </div>
              <div className="border rounded-md divide-y">
                {byWorker.map(([name, total]) => (
                  <div key={name} className="flex justify-between items-center p-3 text-sm">
                    <span className="truncate">{name}</span>
                    <span className="num-mono ml-3 shrink-0">{ZAR(total)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => markPaid.mutate(selectedRows.map((r) => r.id))}
              disabled={markPaid.isPending}
            >
              <CheckCircle2 className="w-4 h-4 mr-1" />
              Confirm — pay {ZAR(selectedTotal)}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View one claim */}
      <Dialog open={!!viewPurchase} onOpenChange={(o) => !o && setViewPurchase(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewPurchase?.description}</DialogTitle>
          </DialogHeader>
          {viewPurchase && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">Worker</div>
                  <div>{employeeById.get(viewPurchase.worker_id) ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Amount</div>
                  <div className="num-mono">{ZAR(viewPurchase.amount)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Category</div>
                  <div>{viewPurchase.category}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Date</div>
                  <div>{new Date(viewPurchase.date).toLocaleDateString("en-ZA")}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Status</div>
                  <Badge variant={statusVariant(viewPurchase.status) as any}>
                    {viewPurchase.status}
                  </Badge>
                </div>
                {viewPurchase.paid_on && (
                  <div>
                    <div className="text-xs text-muted-foreground">Paid on</div>
                    <div>{new Date(viewPurchase.paid_on).toLocaleDateString("en-ZA")}</div>
                  </div>
                )}
              </div>

              {viewPurchase.notes && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Notes</div>
                  <div>{viewPurchase.notes}</div>
                </div>
              )}

              {viewPurchase.voided_reason && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Voided because</div>
                  <div>{viewPurchase.voided_reason}</div>
                </div>
              )}

              {viewPurchase.receipt_urls && viewPurchase.receipt_urls.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-2">
                    Receipt{viewPurchase.receipt_urls.length === 1 ? "" : "s"}
                  </div>
                  {receiptUrl.isLoading && (
                    <div className="text-xs text-muted-foreground">Loading receipt…</div>
                  )}
                  {receiptUrl.data && (
                    <a href={receiptUrl.data} target="_blank" rel="noreferrer">
                      <img
                        src={receiptUrl.data}
                        alt="Receipt"
                        className="max-h-64 rounded-md border hover:opacity-90 transition-opacity cursor-zoom-in"
                      />
                      <div className="text-xs text-muted-foreground mt-1">
                        Click to open full size
                      </div>
                    </a>
                  )}
                  {!receiptUrl.isLoading && !receiptUrl.data && (
                    <div className="text-xs text-muted-foreground">
                      Could not load the receipt photo.
                    </div>
                  )}
                </div>
              )}

              {viewPurchase.status === "pending" && (
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    onClick={() => markOnePaid.mutate(viewPurchase.id)}
                    disabled={markOnePaid.isPending}
                  >
                    <CheckCircle2 className="w-4 h-4 mr-1" />
                    Mark paid
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}