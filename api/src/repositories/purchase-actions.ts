import type { SupabaseClient } from "@supabase/supabase-js";
import type { PoLine, PoLineInput, PurchaseOrder, PurchaseOrderStatus } from "@reef/shared";
import { ApiError } from "../http/errors.js";

type PgError = { code?: string; message: string };

/** The database's purchase order rules speak in messages written for the person reading them. */
function translate(err: PgError): ApiError {
  switch (err.code) {
    case "RF409":
      return new ApiError("CONFLICT", err.message);
    case "RF404":
      return new ApiError("NOT_FOUND", err.message);
    case "23514":
      return new ApiError("VALIDATION_FAILED", err.message);
    case "42501":
      return new ApiError("FORBIDDEN", "You do not have permission to change this order");
    default:
      return new ApiError("INTERNAL", err.message);
  }
}

/**
 * Lines and status changes on a purchase order. Every call answers null when the caller cannot
 * see the order, which T14's plant rule decides in the database, so another plant's order is
 * "not found" rather than "refused".
 */
export interface PurchaseActionsRepository {
  lines(poId: string): Promise<PoLine[] | null>;
  addLine(poId: string, line: PoLineInput): Promise<PoLine | null>;
  /** False when the order is visible but has no such line. */
  removeLine(poId: string, lineId: string): Promise<boolean | null>;
  transition(poId: string, to: PurchaseOrderStatus, reason?: string): Promise<PurchaseOrder | null>;
}

export class SupabasePurchaseActions implements PurchaseActionsRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async visible(poId: string): Promise<boolean> {
    const { data, error } = await this.db
      .from("purchase_orders")
      .select("id")
      .eq("id", poId)
      .maybeSingle();
    if (error) throw translate(error);
    return !!data;
  }

  async lines(poId: string) {
    if (!(await this.visible(poId))) return null;
    const { data, error } = await this.db
      .from("po_lines")
      .select("id, po_id, stock_item_id, qty, unit_cost")
      .eq("po_id", poId)
      .order("id");
    if (error) throw translate(error);
    return (data ?? []) as PoLine[];
  }

  async addLine(poId: string, line: PoLineInput) {
    if (!(await this.visible(poId))) return null;
    let unitCost = line.unit_cost;
    if (unitCost === undefined) {
      const { data, error } = await this.db
        .from("stock_items")
        .select("unit_cost")
        .eq("id", line.stock_item_id)
        .maybeSingle();
      if (error) throw translate(error);
      if (!data) throw new ApiError("NOT_FOUND", "That stock item is not at this order's plant");
      unitCost = Number(data.unit_cost ?? 0);
    }
    const { data, error } = await this.db
      .from("po_lines")
      .insert({
        po_id: poId,
        stock_item_id: line.stock_item_id,
        qty: line.qty,
        unit_cost: unitCost,
      })
      .select("id, po_id, stock_item_id, qty, unit_cost")
      .single();
    if (error) throw translate(error);
    return data as PoLine;
  }

  async removeLine(poId: string, lineId: string) {
    if (!(await this.visible(poId))) return null;
    const { data, error } = await this.db
      .from("po_lines")
      .delete()
      .eq("id", lineId)
      .eq("po_id", poId)
      .select("id");
    if (error) throw translate(error);
    return (data ?? []).length > 0;
  }

  async transition(poId: string, to: PurchaseOrderStatus, reason?: string) {
    const { data, error } = await this.db.rpc("po_transition", {
      _po: poId,
      _to: to,
      _reason: reason ?? null,
    });
    if (error) throw translate(error);
    return ((data ?? []) as PurchaseOrder[])[0] ?? null;
  }
}
