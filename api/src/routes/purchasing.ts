import type { Hono } from "hono";
import { Id, PoAction, PoCancel, PoLineInput, type PurchaseOrderStatus } from "@reef/shared";
import type { AppEnv } from "../app.js";
import { parseBody, parseWith } from "../http/body.js";
import { ok } from "../http/envelope.js";
import { ApiError } from "../http/errors.js";
import type { Registry } from "../registry.js";
import { defineRoute } from "./define.js";

const notFound = () =>
  new ApiError("NOT_FOUND", "That purchase order does not exist, or it isn't at your plant");

const STEPS: { verb: string; to: PurchaseOrderStatus; summary: string; refuses: string }[] = [
  {
    verb: "approve",
    to: "approved",
    summary: "Approves a draft order, so it can be sent to the supplier.",
    refuses: "An order that is not a draft, or has no lines.",
  },
  {
    verb: "order",
    to: "ordered",
    summary:
      "Marks an approved order as sent to the supplier. Optional: an order can be received straight from approved.",
    refuses: "An order that is not approved.",
  },
  {
    verb: "receive",
    to: "received",
    summary: "Marks the delivery as received, which adds its parts to the plant's stock.",
    refuses:
      "An order that is not approved or ordered, and an order already received, so the same delivery can never add stock twice.",
  },
  {
    verb: "cancel",
    to: "cancelled",
    summary: "Cancels an order that has not been received yet, with a reason.",
    refuses:
      "An order already received or cancelled, and a missing reason, because a cancelled order is final.",
  },
];

/**
 * A purchase order's lines and the steps it moves through. The rules themselves (lines only on a
 * draft, status one way, received once) are in the database, so they also hold for T14's plain
 * PATCH and for the prototype; these routes give each step its own address and a plain refusal.
 */
export function purchasingRoutes(app: Hono<AppEnv>, registry: Registry) {
  const base = "/api/v1/purchase-orders/:id";

  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: `${base}/lines`,
      access: "po:read",
      summary: "Lists the lines on one purchase order: which part, how many, and at what price.",
      refuses: "Workers, and an order at another plant, which answers not found.",
    },
    async (c) => {
      const lines = await c.var.repos.purchaseActions.lines(parseWith(Id, c.req.param("id")));
      if (!lines) throw notFound();
      return ok(c, lines);
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "POST",
      path: `${base}/lines`,
      access: "po:write",
      summary:
        "Adds a line to a draft order. Leave the price out to use the part's catalogue price. The order's total follows.",
      refuses:
        "An order that is no longer a draft, because what was approved must be what is ordered; a part from another " +
        "plant; a quantity of zero or less; and workers.",
    },
    async (c) => {
      const id = parseWith(Id, c.req.param("id"));
      const line = await parseBody(c, PoLineInput);
      const created = await c.var.repos.purchaseActions.addLine(id, line);
      if (!created) throw notFound();
      return ok(c, created, 201);
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "DELETE",
      path: `${base}/lines/:lineId`,
      access: "po:write",
      summary: "Removes a line from a draft order. The order's total follows.",
      refuses: "An order that is no longer a draft, a line that is not on this order, and workers.",
    },
    async (c) => {
      const id = parseWith(Id, c.req.param("id"));
      const lineId = parseWith(Id, c.req.param("lineId"));
      const removed = await c.var.repos.purchaseActions.removeLine(id, lineId);
      if (removed === null) throw notFound();
      if (!removed) throw new ApiError("NOT_FOUND", "That line is not on this order");
      return ok(c, { id: lineId, deleted: true });
    },
  );

  for (const step of STEPS) {
    defineRoute(
      app,
      registry,
      {
        method: "POST",
        path: `${base}/${step.verb}`,
        access: "po:write",
        summary: step.summary,
        refuses: `${step.refuses} Also workers, and another plant's order, which answers not found.`,
      },
      async (c) => {
        const id = parseWith(Id, c.req.param("id"));
        const { reason } = await parseBody(c, step.to === "cancelled" ? PoCancel : PoAction);
        const order = await c.var.repos.purchaseActions.transition(id, step.to, reason);
        if (!order) throw notFound();
        return ok(c, order);
      },
    );
  }
}
