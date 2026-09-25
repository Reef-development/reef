/**
 * T9's fallback: when the drafted answer doesn't pass the number check, we don't retry the
 * model and hope for the better (that just risks a second invented number). Instead we hand
 * back the raw figures the tools already fetched this turn, laid out plainly with no prose
 * generated on top of them, so nothing in the fallback itself needs verifying.
 */

type ToolCallRecord = { toolName: string; output: unknown };

type InventoryOutput = {
  total_items: number;
  inventory_value: number;
  low_stock: Array<{ name: string }>;
  purchase_orders: unknown[];
};

type MaintenanceOutput = {
  window_days: number;
  maintenance_spend: number;
  repairs: unknown[];
  overdue: unknown[];
  downtime: unknown[];
};

type ProductionOutput = {
  window_months: number;
  total_tons: number;
  variable_costs: number;
  maintenance_costs: number;
  static_costs: number;
  cost_per_ton: number | null;
};

/** Matches the existing "R1 234.56" convention set in chat.ts's system prompt: space-separated
 *  thousands, period decimal. Deliberately not en-ZA's toLocaleString output, which uses a
 *  comma decimal separator and would read inconsistently next to Reefie's normal answers. */
function formatRand(n: unknown): string {
  const v = Number(n ?? 0);
  const [whole, decimals = "00"] = v.toFixed(2).split(".");
  const withSpaces = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `R${withSpaces}.${decimals}`;
}

function renderInventory(o: InventoryOutput): string[] {
  const lines = [
    `- Total stock items: ${o.total_items}`,
    `- Inventory value: ${formatRand(o.inventory_value)}`,
  ];
  if (Array.isArray(o.low_stock) && o.low_stock.length > 0) {
    lines.push(
      `- At or below reorder point (${o.low_stock.length}): ${o.low_stock.map((i) => i.name).join(", ")}`,
    );
  } else {
    lines.push(`- Nothing is at or below its reorder point`);
  }
  if (Array.isArray(o.purchase_orders)) {
    lines.push(`- Open purchase orders on file: ${o.purchase_orders.length}`);
  }
  return lines;
}

function renderMaintenance(o: MaintenanceOutput): string[] {
  const lines = [
    `- Maintenance spend (last ${o.window_days} days): ${formatRand(o.maintenance_spend)}`,
    `- Repairs logged: ${Array.isArray(o.repairs) ? o.repairs.length : 0}`,
    `- Overdue services: ${Array.isArray(o.overdue) ? o.overdue.length : 0}`,
  ];
  if (Array.isArray(o.downtime) && o.downtime.length > 0) {
    lines.push(`- Downtime events logged: ${o.downtime.length}`);
  }
  return lines;
}

function renderProductionAndCosts(o: ProductionOutput): string[] {
  return [
    `- Window: last ${o.window_months} months`,
    `- Total tonnes produced: ${o.total_tons}`,
    `- Variable costs: ${formatRand(o.variable_costs)}`,
    `- Maintenance costs: ${formatRand(o.maintenance_costs)}`,
    `- Static costs: ${formatRand(o.static_costs)}`,
    `- Cost per ton: ${o.cost_per_ton !== null && o.cost_per_ton !== undefined ? formatRand(o.cost_per_ton) : "not available"}`,
  ];
}

const RENDERERS: Record<string, (o: never) => string[]> = {
  inventory_status: renderInventory as (o: never) => string[],
  maintenance_status: renderMaintenance as (o: never) => string[],
  production_and_costs: renderProductionAndCosts as (o: never) => string[],
};

export function buildFallbackAnswer(toolCalls: ToolCallRecord[]): string {
  const sections: string[] = [];
  for (const call of toolCalls) {
    const render = RENDERERS[call.toolName];
    if (!render) continue;
    try {
      sections.push(
        [`**${call.toolName.replace(/_/g, " ")}**`, ...render(call.output as never)].join("\n"),
      );
    } catch {
      // If a renderer trips over an unexpected shape, skip that section rather than fail the
      // whole fallback — the point of the fallback is to always be safe to show.
    }
  }

  const body =
    sections.length > 0
      ? sections.join("\n\n")
      : "I fetched the figures but couldn't lay them out safely.";

  return [
    "I drafted an answer, but one or more of the numbers in it didn't match the data I fetched, so I've thrown that draft away rather than risk showing you a wrong figure.",
    "Here are the raw figures instead:",
    "",
    body,
    "",
    "Ask me again, or rephrase the question, and I'll try drafting a fresh answer.",
  ].join("\n");
}
