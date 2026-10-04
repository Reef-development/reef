/**
 * T9's fallback: when the drafted answer doesn't pass the number check, we hand back the
 * raw figures the tools already fetched this turn, laid out plainly. Nothing in the
 * fallback itself needs verifying.
 */

type ToolCallRecord = {
  toolName?: string;
  name?: string;
  tool?: string;
  output: unknown;
};

function formatRand(n: unknown): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "R0.00";
  const [whole, decimals = "00"] = v.toFixed(2).split(".");
  const withSpaces = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `R${withSpaces}.${decimals}`;
}

function renderInventory(o: unknown): string[] {
  const data = (o ?? {}) as {
    total_items?: unknown;
    inventory_value?: unknown;
    low_stock?: unknown;
    purchase_orders?: unknown;
  };
  const lines: string[] = [];
  lines.push(`- Total stock items: ${Number(data.total_items ?? 0)}`);
  lines.push(`- Inventory value: ${formatRand(Number(data.inventory_value ?? 0))}`);
  if (Array.isArray(data.low_stock) && data.low_stock.length > 0) {
    lines.push(`- At or below reorder point: ${data.low_stock.length}`);
    for (const item of data.low_stock.slice(0, 10) as Array<{
      name?: string;
      qty_on_hand?: unknown;
    }>) {
      lines.push(`  - ${item.name ?? "unnamed"}: ${Number(item.qty_on_hand ?? 0)}`);
    }
  } else {
    lines.push(`- Nothing is at or below its reorder point`);
  }
  if (Array.isArray(data.purchase_orders)) {
    lines.push(`- Open purchase orders on file: ${data.purchase_orders.length}`);
  }
  return lines;
}

function renderMaintenance(o: unknown): string[] {
  const data = (o ?? {}) as {
    window_days?: unknown;
    maintenance_spend?: unknown;
    repair_count?: unknown;
    overdue_count?: unknown;
    equipment_by_life_used?: unknown;
    downtime_count?: unknown;
    recent_downtime?: unknown;
  };
  const lines: string[] = [];
  lines.push(
    `- Maintenance spend (last ${Number(data.window_days ?? 90)} days): ${formatRand(Number(data.maintenance_spend ?? 0))}`,
  );
  lines.push(`- Repairs logged: ${Number(data.repair_count ?? 0)}`);
  lines.push(`- Overdue services: ${Number(data.overdue_count ?? 0)}`);
  if (data.downtime_count !== undefined) {
    lines.push(`- Downtime events: ${Number(data.downtime_count)}`);
  }
  if (Array.isArray(data.equipment_by_life_used) && data.equipment_by_life_used.length > 0) {
    lines.push(`- Equipment by life used (highest first):`);
    for (const e of data.equipment_by_life_used as Array<{
      name?: string;
      life_used_pct?: unknown;
      tons_since_install?: unknown;
      expected_life_tons?: unknown;
    }>) {
      lines.push(
        `  - ${e.name ?? "unnamed"}: ${Number(e.life_used_pct ?? 0)}% used (${Number(e.tons_since_install ?? 0)} of ${Number(e.expected_life_tons ?? 0)} tons)`,
      );
    }
  } else {
    lines.push(`- No equipment has expected-life data on file`);
  }
  if (Array.isArray(data.recent_downtime) && data.recent_downtime.length > 0) {
    lines.push(`- Recent downtime reasons:`);
    for (const d of data.recent_downtime as Array<{ reason?: string; hours?: unknown }>) {
      lines.push(`  - ${d.reason ?? "unspecified"}: ${Number(d.hours ?? 0)}h`);
    }
  }
  return lines;
}

function renderProductionAndCosts(o: unknown): string[] {
  const data = (o ?? {}) as {
    window_months?: unknown;
    total_tons?: unknown;
    variable_costs?: unknown;
    maintenance_costs?: unknown;
    static_costs?: unknown;
    cost_per_ton?: unknown;
    mine_count?: unknown;
    client_count?: unknown;
  };
  const lines: string[] = [
    `- Window: last ${Number(data.window_months ?? 6)} months`,
    `- Total tonnes produced: ${Number(data.total_tons ?? 0)}`,
    `- Variable costs: ${formatRand(Number(data.variable_costs ?? 0))}`,
    `- Maintenance costs: ${formatRand(Number(data.maintenance_costs ?? 0))}`,
    `- Static costs: ${formatRand(Number(data.static_costs ?? 0))}`,
    `- Cost per ton: ${
      data.cost_per_ton !== null && data.cost_per_ton !== undefined
        ? formatRand(Number(data.cost_per_ton))
        : "not available"
    }`,
  ];
  if (data.mine_count !== undefined) lines.push(`- Mines reporting: ${Number(data.mine_count)}`);
  if (data.client_count !== undefined)
    lines.push(`- Clients on file: ${Number(data.client_count)}`);
  return lines;
}

function renderHeadcount(o: unknown): string[] {
  const data = (o ?? {}) as { total?: unknown; by_shift?: unknown };
  const lines: string[] = [`- Total employees: ${Number(data.total ?? 0)}`];
  if (data.by_shift && typeof data.by_shift === "object") {
    for (const [shift, count] of Object.entries(data.by_shift as Record<string, unknown>)) {
      lines.push(`- On ${shift} shift: ${Number(count ?? 0)}`);
    }
  }
  return lines;
}

const RENDERERS: Record<string, (o: unknown) => string[]> = {
  inventory_status: renderInventory,
  maintenance_status: renderMaintenance,
  production_and_costs: renderProductionAndCosts,
  headcount: renderHeadcount,
};

function toolNameOf(call: ToolCallRecord): string {
  return call.toolName ?? call.name ?? call.tool ?? "";
}

export function buildFallbackAnswer(toolCalls: ToolCallRecord[]): string {
  if (toolCalls.length === 0) {
    return [
      "I drafted an answer, but I didn't fetch any figures from the database first, so I can't stand behind anything I would have said.",
      "",
      "Ask me the question again, phrased as a direct request for the data (for example, \"what items do we have in stock?\"), and I'll fetch the figures properly before answering.",
    ].join("\n");
  }

  const sections: string[] = [];
  for (const call of toolCalls) {
    const name = toolNameOf(call) || "tool";
    const render = RENDERERS[name];
    let rendered = false;
    if (render) {
      try {
        sections.push([`**${name.replace(/_/g, " ")}**`, ...render(call.output)].join("\n"));
        rendered = true;
      } catch (err) {
        console.error("reefie: fallback renderer failed for", name, err);
      }
    }
    if (!rendered) {
      try {
        const raw = JSON.stringify(call.output, null, 2);
        sections.push([`**${name.replace(/_/g, " ")}**`, "```json", raw, "```"].join("\n"));
      } catch {
        sections.push(`**${name.replace(/_/g, " ")}**\n(could not render)`);
      }
    }
  }
  const body = sections.join("\n\n");
  return [
    "I drafted an answer, but one or more of the numbers in it didn't match the data I fetched, so I've thrown that draft away rather than risk showing you a wrong figure.",
    "Here are the raw figures instead:",
    "",
    body,
    "",
    "Ask me again, or rephrase the question, and I'll try drafting a fresh answer.",
  ].join("\n");
}