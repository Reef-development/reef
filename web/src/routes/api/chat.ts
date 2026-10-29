import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  stepCountIs,
  tool,
  type UIMessage,
} from "ai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createGroq } from "@ai-sdk/groq";
import { verifyAnswer, type CheckResult } from "@/lib/reefie/number-proof";
import { buildFallbackAnswer } from "@/lib/reefie/fallback-template";
import { isSiteComparisonRequest, SITE_COMPARISON_REFUSAL } from "@/lib/reefie/site-guard";
import { withDerivedCosts } from "@/lib/reefie/derived-costs";
import { ungroundedTerms } from "@/lib/reefie/scope-guard";

type ChatBody = { messages?: unknown; threadId?: unknown };

const SYSTEM = `You are Reefie, the operations assistant for R.E.E.F (Resource Energy Engineering Fuels),
a South African contract mining services company (est. 2014, head office Farm 43 Hekpoort, crews across Mpumalanga mines).

You help the owner and managers with three things:
1. Answering questions about their live operational data (stock, maintenance, production, costs, downtime, purchase orders, and staff).
2. Practical mining operations advice (maintenance planning, wear-and-tear, cost control, magnetite usage, overtime).
3. Drafting reports and monthly performance summaries.

Rules:
- When the user asks about data (stock, staff, maintenance, production, costs, downtime, purchase orders), ALWAYS call the matching tool for this turn, even if the same information appeared earlier in the conversation.
- When quoting figures from a tool result, use only the exact numbers in that result. Do not round, sum, average, or derive new numbers. Do not add a percentage that is not already in the result.
- When quoting figures from tools, copy them exactly as returned (e.g. "R162,750,000.00", "R247.85", "71.09%"). Never abbreviate with "million" or "thousand"; write the full number.
- When quoting any total, always state the time window it covers (e.g. "R3 748 677.05 over the last 30 days"). Never present a figure without saying what period it covers.
- "This month" means months: 1. "Last month" means months: 1. "Last quarter" means months: 3. For change questions, use months: 1 unless the user says otherwise.
- For per-ton and share-of-cost figures, use the derived fields the tool returns (static_per_ton, static_share_pct, etc.). Do not compute them yourself.
- Before answering, check the tool's \`_scope\`. If the question asks about something listed under \`_scope.doesNotCover\`, or about an item (equipment, vehicle, site, person) that does not appear in the tool output, reply: "I don't have data on <thing>." Then state what the tool does cover. Never relabel a total as belonging to a subset.
- When explaining why a figure is what it is, cite only the components and amounts the tool returned. Do not name specific cost items (salaries, depreciation, overtime, materials, plant overhead) unless they appear in the tool output.
- If the user asks why a figure changed ("why this month") and the tool returns previous_period: use its values to explain the movement. Quote the numbers, not the field names. Never write identifiers like "previous_period.cost_per_ton_change_pct" in the answer — write "3.72%" instead. If previous_period is missing or its change fields are null, say plainly that you can only show the current composition, not the change.
- For headcount and staff questions, use the headcount tool. Do not guess how many employees REEF has. Quote only the total and the shift breakdown.
- For "which equipment is closest to end of life" questions, use the equipment_by_life_used array from the maintenance_status tool. Quote the percentages exactly as returned, in the order returned.
- For downtime questions ("which mine has the most downtime", "downtime hours per mine", "downtime reasons"), use the downtime_by_mine tool. Quote hours and cost exactly as returned, and name the window.
- If a question cannot be answered from the tools you have, say so plainly and suggest what data would need to be captured. Do not invent an answer.
- Only attribute a figure to what the tool result calls it. If the tool returns a total across all equipment, do not claim it is specific to one type. If the user asks for a subset the tools cannot isolate, say so and stop. Do not present the total as an answer to a subset question.
- Currency is South African Rand; format as R1 234.56. Tonnes are metric.
- Be concise, practical and direct. Use markdown: short headings, bullets, small tables.
- If data is missing, say so plainly and suggest what to capture.`;

function userClient(token: string) {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

type NumberCheck = {
  passed: boolean;
  unverifiedNumbers: number[];
  reason: "ok" | "number_mismatch" | "out_of_scope" | "no_tool_call";
};

function respondWithFinalText(
  finalText: string,
  opts: {
    uiMessages: UIMessage[];
    supabase: SupabaseClient;
    threadId: string;
    userId: string;
    numberCheck: NumberCheck | null;
  },
) {
  const stream = createUIMessageStream({
    originalMessages: opts.uiMessages,
    execute: ({ writer }) => {
      const id = "reefie-answer";
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: finalText });
      writer.write({ type: "text-end", id });
    },
    onFinish: async ({ responseMessage }) => {
      const { error } = await opts.supabase.from("reefie_messages").insert({
        thread_id: opts.threadId,
        user_id: opts.userId,
        role: "assistant",
        message: responseMessage as unknown as Record<string, unknown>,
      });
      if (error) console.error("reefie: failed to save assistant message", error);
      await opts.supabase
        .from("reefie_threads")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", opts.threadId);

      if (opts.numberCheck) {
        const { error: checkError } = await opts.supabase.from("reefie_answer_checks").insert({
          thread_id: opts.threadId,
          user_id: opts.userId,
          passed: opts.numberCheck.passed,
          unverified_numbers: opts.numberCheck.unverifiedNumbers,
          reason: opts.numberCheck.reason,
        });
        if (checkError) console.error("reefie: failed to log number check", checkError);
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}

function badValues(check: CheckResult): number[] {
  return check.ok ? [] : check.badNumbers.map((n) => n.value);
}

function makeRecorderFor(captured: Array<{ toolName: string; output: unknown }>) {
  function recordTool(
    name: string,
    def: {
      description: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: z.ZodType<any>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: (input: any) => Promise<unknown>;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any {
    return tool({
      description: def.description,
      inputSchema: def.inputSchema,
      execute: async (input) => {
        const output = await def.execute(input);
        captured.push({ toolName: name, output });
        return output;
      },
    });
  }
  return { recordTool };
}

/**
 * Calendar-aligned month windows.
 *   current:  N complete calendar months, ending with last month
 *   previous: N complete calendar months immediately before current
 * No setMonth overflow, no partial current month.
 */
function monthWindow(n: number) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const curFrom = new Date(Date.UTC(y, m - n, 1));
  const curUntil = new Date(Date.UTC(y, m, 1));
  const prevFrom = new Date(Date.UTC(y, m - 2 * n, 1));
  const prevUntil = curFrom;
  return {
    since: iso(curFrom),
    until: iso(curUntil),
    prevSince: iso(prevFrom),
    prevUntil: iso(prevUntil),
  };
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.replace(/^Bearer\s+/i, "");
        if (!token) return new Response("Unauthorized", { status: 401 });

        const supabase = userClient(token);
        const { data: userData, error: userErr } = await supabase.auth.getUser(token);
        if (userErr || !userData.user) return new Response("Unauthorized", { status: 401 });
        const userId = userData.user.id;

        const body = (await request.json()) as ChatBody;
        const messages = body.messages;
        const threadId = typeof body.threadId === "string" ? body.threadId : null;
        if (!Array.isArray(messages)) return new Response("Messages are required", { status: 400 });
        if (!threadId) return new Response("threadId is required", { status: 400 });

        const { data: thread } = await supabase
          .from("reefie_threads")
          .select("id, title")
          .eq("id", threadId)
          .maybeSingle();
        if (!thread) return new Response("Thread not found", { status: 404 });

        // Prefer the server-side variable; fall back to the Vite one for local dev.
        // VITE_-prefixed vars are inlined into the browser bundle, so in production
        // only GROQ_API_KEY (server-only) should be set.
        const key =
          (typeof process !== "undefined" ? process.env?.GROQ_API_KEY : undefined) ??
          (import.meta.env.VITE_GROQ_API_KEY as string | undefined);
        if (!key) return new Response("Missing GROQ_API_KEY", { status: 500 });

        const uiMessages = messages as UIMessage[];
        const last = uiMessages[uiMessages.length - 1];
        let lastUserText = "";
        if (last && last.role === "user") {
          const { error } = await supabase.from("reefie_messages").insert({
            thread_id: threadId,
            user_id: userId,
            role: "user",
            message: last as unknown as Record<string, unknown>,
          });
          if (error) console.error("reefie: failed to save user message", error);

          lastUserText = last.parts
            .map((p) => (p.type === "text" ? p.text : ""))
            .join(" ")
            .trim();

          if (!thread.title || thread.title === "New conversation") {
            const text = lastUserText.slice(0, 60);
            if (text)
              await supabase.from("reefie_threads").update({ title: text }).eq("id", threadId);
          }
        }

        if (lastUserText && isSiteComparisonRequest(lastUserText)) {
          return respondWithFinalText(SITE_COMPARISON_REFUSAL, {
            uiMessages,
            supabase,
            threadId,
            userId,
            numberCheck: null,
          });
        }

        const num = (v: unknown) => Number(v ?? 0);

        function buildTools(captured: Array<{ toolName: string; output: unknown }>) {
          const { recordTool } = makeRecorderFor(captured);
          return {
            inventory_status: recordTool("inventory_status", {
              description:
                "Stock levels, items at or below reorder point, total inventory value, and open purchase orders.",
              inputSchema: z.object({}),
              execute: async () => {
                const [{ data: items }, { data: levels }, { data: pos }] = await Promise.all([
                  supabase.from("stock_items").select("id, name, sku, unit, unit_cost"),
                  supabase
                    .from("stock_levels")
                    .select("stock_item_id, plant, qty_on_hand, reorder_point, reorder_qty"),
                  supabase
                    .from("purchase_orders")
                    .select("id, status, total_cost, created_at")
                    .order("created_at", { ascending: false })
                    .limit(25),
                ]);

                const catalogue = items ?? [];
                const stock = levels ?? [];
                const byId = new Map(catalogue.map((i) => [i.id, i]));

                const totalValue = stock.reduce((s, l) => {
                  const item = byId.get(l.stock_item_id);
                  return s + num(l.qty_on_hand) * num(item?.unit_cost);
                }, 0);

                const lowStock = stock
                  .filter((l) => num(l.qty_on_hand) <= num(l.reorder_point))
                  .slice(0, 20)
                  .map((l) => ({
                    name: byId.get(l.stock_item_id)?.name ?? "unknown",
                    plant: l.plant,
                    qty_on_hand: num(l.qty_on_hand),
                  }));

                return {
                  total_items: catalogue.length,
                  inventory_value: totalValue,
                  low_stock: lowStock,
                  purchase_orders: (pos ?? []).slice(0, 5).map((p) => ({
                    status: p.status,
                    total_cost: p.total_cost,
                  })),
                  _scope: {
                    covers:
                      "stock catalogue, current stock levels per plant, items at or below reorder point, and recent purchase orders",
                    doesNotCover: [
                      "forecast stock usage",
                      "individual stock movements or issue history",
                      "purchase orders older than the most recent 25",
                    ],
                  },
                };
              },
            }),
            maintenance_status: recordTool("maintenance_status", {
              description:
                "Recent repairs, maintenance spend, overdue services and equipment wear/life remaining. Use this for questions about which equipment is closest to end of life, or which equipment needs the most attention.",
              inputSchema: z.object({
                days: z.number().optional().describe("Look-back window in days, default 30"),
              }),
              execute: async ({ days }: { days?: number }) => {
                const windowDays = days ?? 30;
                const since = new Date(Date.now() - windowDays * 864e5)
                  .toISOString()
                  .slice(0, 10);
                const today = new Date().toISOString().slice(0, 10);
                const [{ data: logs }, { data: equip }, { data: down }] = await Promise.all([
                  supabase
                    .from("maintenance_logs")
                    .select("date, description, total_cost, next_due_date, equipment_id")
                    .gte("date", since)
                    .order("date", { ascending: false }),
                  supabase
                    .from("equipment")
                    .select(
                      "id, name, type, status, tons_since_install, expected_life_tons, mine_id",
                    ),
                  supabase
                    .from("downtime_events")
                    .select("reason, start_time, duration_hours, estimated_cost")
                    .gte("start_time", since)
                    .order("start_time", { ascending: false })
                    .limit(50),
                ]);
                const eq = equip ?? [];
                const logsArr = logs ?? [];
                const downArr = down ?? [];
                return {
                  window_days: windowDays,
                  maintenance_spend: logsArr.reduce((s, l) => s + num(l.total_cost), 0),
                  repair_count: logsArr.length,
                  overdue_count: logsArr.filter(
                    (l) => l.next_due_date && l.next_due_date <= today,
                  ).length,
                  equipment_by_life_used: eq
                    .filter((e) => num(e.expected_life_tons) > 0)
                    .map((e) => ({
                      name: e.name,
                      life_used_pct: Math.round(
                        (num(e.tons_since_install) / num(e.expected_life_tons)) * 100,
                      ),
                      tons_since_install: num(e.tons_since_install),
                      expected_life_tons: num(e.expected_life_tons),
                    }))
                    .sort((a, b) => b.life_used_pct - a.life_used_pct)
                    .slice(0, 5),
                  downtime_count: downArr.length,
                  recent_downtime: downArr.slice(0, 5).map((d) => ({
                    reason: d.reason,
                    hours: d.duration_hours,
                  })),
                  _scope: {
                    covers:
                      "site-wide maintenance spend across all equipment for the last 30 days, plus a list of the top five machines by life-used percentage and recent downtime events",
                    doesNotCover: [
                      "per-equipment maintenance costs (only the sum across all equipment)",
                      "per-mine maintenance breakdown",
                      "maintenance on any equipment type that is not in the equipment_by_life_used list",
                      "helicopters, aircraft, or any machine type not present in the REEF fleet",
                    ],
                  },
                };
              },
            }),
            downtime_by_mine: recordTool("downtime_by_mine", {
              description:
                "Downtime events grouped by mine over a look-back window. Use this for questions about which mine has the most downtime, downtime hours per mine, downtime cost per mine, or the reasons for downtime at each mine.",
              inputSchema: z.object({
                days: z.number().optional().describe("Look-back window in days, default 30"),
                mine_name: z
                  .string()
                  .optional()
                  .describe("Optional: restrict to one mine by name"),
              }),
              execute: async ({
                days,
                mine_name,
              }: {
                days?: number;
                mine_name?: string;
              }) => {
                const windowDays = days ?? 30;
                const since = new Date(Date.now() - windowDays * 864e5)
                  .toISOString()
                  .slice(0, 10);

                const [{ data: events }, { data: mines }] = await Promise.all([
                  supabase
                    .from("downtime_events")
                    .select("mine_id, reason, duration_hours, estimated_cost, start_time")
                    .gte("start_time", since)
                    .order("start_time", { ascending: false }),
                  supabase.from("mines").select("id, name, location, active"),
                ]);

                const mineById = new Map((mines ?? []).map((m) => [m.id, m]));

                const byMine: Record<
                  string,
                  {
                    hours: number;
                    cost: number;
                    events: number;
                    reasons: Record<string, number>;
                  }
                > = {};

                for (const e of events ?? []) {
                  const mine = mineById.get(e.mine_id ?? "");
                  const name = mine?.name ?? "unknown";
                  if (mine_name && name !== mine_name) continue;

                  if (!byMine[name]) {
                    byMine[name] = { hours: 0, cost: 0, events: 0, reasons: {} };
                  }
                  const h = Number(e.duration_hours ?? 0);
                  byMine[name].hours += h;
                  byMine[name].cost += Number(e.estimated_cost ?? 0);
                  byMine[name].events += 1;
                  const reason = e.reason ?? "unknown";
                  byMine[name].reasons[reason] = (byMine[name].reasons[reason] ?? 0) + h;
                }

                const ranked = Object.entries(byMine)
                  .map(([name, v]) => ({
                    mine: name,
                    hours: Math.round(v.hours * 100) / 100,
                    cost: Math.round(v.cost * 100) / 100,
                    events: v.events,
                    reasons: Object.fromEntries(
                      Object.entries(v.reasons).map(([r, h]) => [
                        r,
                        Math.round(h * 100) / 100,
                      ]),
                    ),
                  }))
                  .sort((a, b) => b.hours - a.hours);

                return {
                  window_days: windowDays,
                  filter: mine_name ?? null,
                  total_events: (events ?? []).length,
                  by_mine: ranked,
                  _scope: {
                    covers: `downtime_events grouped by mine for the last ${windowDays} days: hours lost, estimated cost in rand, event count, and reason breakdown per mine`,
                    doesNotCover: [
                      "per-equipment downtime (only per mine)",
                      "downtime for mines not in the returned by_mine list",
                      "future downtime forecasts",
                    ],
                  },
                };
              },
            }),
            production_and_costs: recordTool("production_and_costs", {
              description:
                "Tonnes produced, variable costs (split into magnetite and overtime), maintenance costs, static costs (grouped by category), and rand-per-ton for the last N completed calendar months. Also returns the previous N months' totals and the change in cost per ton for comparison.",
              inputSchema: z.object({
                months: z.number().optional().describe("Look-back window in months, default 6"),
              }),
              execute: async ({ months }: { months?: number }) => {
                const n = months ?? 6;
                const win = monthWindow(n);

                const [
                  { data: prod },
                  { data: statics },
                  { data: logs },
                  { data: mines },
                  { data: clients },
                  { data: prevProd },
                  { data: prevStatics },
                  { data: prevLogs },
                ] = await Promise.all([
                  supabase
                    .from("production_logs")
                    .select(
                      "date, mine_id, tons_produced, magnetite_used, magnetite_cost, overtime_hours, overtime_cost",
                    )
                    .gte("date", win.since)
                    .lt("date", win.until),
                  supabase
                    .from("static_costs")
                    .select("month, mine_id, category, amount")
                    .gte("month", win.since)
                    .lt("month", win.until),
                  supabase
                    .from("maintenance_logs")
                    .select("date, total_cost, equipment_id")
                    .gte("date", win.since)
                    .lt("date", win.until),
                  supabase.from("mines").select("id, name, team_name, location, active"),
                  supabase.from("clients").select("id, name, active, contract_revenue_monthly"),
                  supabase
                    .from("production_logs")
                    .select("tons_produced, magnetite_cost, overtime_cost")
                    .gte("date", win.prevSince)
                    .lt("date", win.prevUntil),
                  supabase
                    .from("static_costs")
                    .select("amount")
                    .gte("month", win.prevSince)
                    .lt("month", win.prevUntil),
                  supabase
                    .from("maintenance_logs")
                    .select("total_cost")
                    .gte("date", win.prevSince)
                    .lt("date", win.prevUntil),
                ]);

                const prodArr = prod ?? [];
                const tons = prodArr.reduce((s, p) => s + num(p.tons_produced), 0);
                const variable = prodArr.reduce(
                  (s, p) => s + num(p.magnetite_cost) + num(p.overtime_cost),
                  0,
                );
                const maint = (logs ?? []).reduce((s, l) => s + num(l.total_cost), 0);
                const fixed = (statics ?? []).reduce((s, c) => s + num(c.amount), 0);

                const staticByCategory: Record<string, number> = {};
                for (const c of statics ?? []) {
                  const key = c.category ?? "uncategorised";
                  staticByCategory[key] = (staticByCategory[key] ?? 0) + num(c.amount);
                }

                let magnetite = 0;
                let overtime = 0;
                for (const p of prodArr) {
                  magnetite += num(p.magnetite_cost);
                  overtime += num(p.overtime_cost);
                }

                const prevTons = (prevProd ?? []).reduce((s, p) => s + num(p.tons_produced), 0);
                const prevVariable = (prevProd ?? []).reduce(
                  (s, p) => s + num(p.magnetite_cost) + num(p.overtime_cost),
                  0,
                );
                const prevMaint = (prevLogs ?? []).reduce((s, l) => s + num(l.total_cost), 0);
                const prevFixed = (prevStatics ?? []).reduce((s, c) => s + num(c.amount), 0);
                const prevTotal = prevVariable + prevMaint + prevFixed;

                const currentCostPerTon = tons > 0 ? (variable + maint + fixed) / tons : null;
                const prevCostPerTon = prevTons > 0 ? prevTotal / prevTons : null;
                const changePct =
                  currentCostPerTon !== null && prevCostPerTon !== null && prevCostPerTon !== 0
                    ? ((currentCostPerTon - prevCostPerTon) / prevCostPerTon) * 100
                    : null;
                const changeDelta =
                  currentCostPerTon !== null && prevCostPerTon !== null
                    ? currentCostPerTon - prevCostPerTon
                    : null;

                const dataNotes: string[] = [];
                if (prevTons === 0) {
                  dataNotes.push(
                    "previous period has no production rows, so change figures are null",
                  );
                }
                if ((prevStatics ?? []).length === 0) {
                  dataNotes.push("previous period has no static costs, so cost_per_ton comparison may be misleading");
                }
                if (prodArr.length === 0) {
                  dataNotes.push("current period has no production rows in the window");
                }

                return withDerivedCosts({
                  window_months: n,
                  window_label: `${win.since} to ${win.until} (exclusive)`,
                  previous_window_label: `${win.prevSince} to ${win.prevUntil} (exclusive)`,
                  total_tons: tons,
                  variable_costs: variable,
                  maintenance_costs: maint,
                  static_costs: fixed,
                  mine_count: (mines ?? []).length,
                  client_count: (clients ?? []).length,
                  static_by_category: staticByCategory,
                  variable_by_component: { magnetite, overtime },
                  previous_period: {
                    total_tons: prevTons,
                    cost_per_ton: prevCostPerTon,
                    static_costs: prevFixed,
                    variable_costs: prevVariable,
                    maintenance_costs: prevMaint,
                    total_cost: prevTotal,
                    cost_per_ton_change_pct: changePct,
                    cost_per_ton_delta: changeDelta,
                  },
                  dataNotes,
                });
              },
            }),
            headcount: recordTool("headcount", {
              description:
                "How many employees REEF has, optionally broken down by mine or shift. Use this for questions like 'how many workers do we have', 'how many on the night shift', or 'who works at Kangala'.",
              inputSchema: z.object({
                mine_id: z.string().uuid().optional().describe("Limit to one mine"),
                shift: z
                  .enum(["morning", "midday", "night"])
                  .optional()
                  .describe("Limit to one shift"),
                active_only: z
                  .boolean()
                  .optional()
                  .describe("Only count employees with active=true, default true"),
              }),
              execute: async ({
                mine_id,
                shift,
                active_only,
              }: {
                mine_id?: string;
                shift?: "morning" | "midday" | "night";
                active_only?: boolean;
              }) => {
                let q = supabase
                  .from("employees")
                  .select("id, shift, active", { count: "exact" });
                if (active_only !== false) q = q.eq("active", true);
                if (mine_id) q = q.eq("mine_id", mine_id);
                if (shift) q = q.eq("shift", shift);
                const { data, count, error } = await q;
                if (error) throw error;

                const list = data ?? [];
                const byShift = list.reduce<Record<string, number>>((acc, e) => {
                  const key = e.shift ?? "unknown";
                  acc[key] = (acc[key] ?? 0) + 1;
                  return acc;
                }, {});

                return {
                  total: count ?? list.length,
                  by_shift: byShift,
                  _scope: {
                    covers:
                      "current active employee headcount, optionally filtered by mine or shift",
                    doesNotCover: [
                      "historical headcount",
                      "individual personnel files or ID numbers",
                      "contractors or sub-contractors",
                    ],
                  },
                };
              },
            }),
          };
        }

        const groq = createGroq({ apiKey: key });

        const recentMessages = uiMessages.slice(-10);
        const modelMessages = await convertToModelMessages(recentMessages);

        // Attempt 1: normal call, model decides.
        const captured1: Array<{ toolName: string; output: unknown }> = [];
        const tools1 = buildTools(captured1);
        const result1 = await generateText({
          model: groq("openai/gpt-oss-120b") as never,
          system: SYSTEM,
          messages: modelMessages,
          tools: tools1,
          stopWhen: stepCountIs(6),
        });

        const check1 = verifyAnswer(result1.text, captured1.map((c) => c.output));

        // Log-only scope check: measure false positives without refusing.
        const missingTerms = lastUserText
          ? ungroundedTerms(lastUserText, captured1.map((c) => c.output))
          : [];
        if (missingTerms.length > 0) {
          console.warn("[scope-guard] possible out-of-scope terms:", missingTerms);
        }

        let finalText: string;
        let numberCheck: NumberCheck;
        const allCaptured = [...captured1];

        if (check1.ok && captured1.length > 0) {
          finalText = result1.text;
          numberCheck = { passed: true, unverifiedNumbers: [], reason: "ok" };
        } else if (captured1.length === 0) {
          // The model answered without calling a tool. Give it one more chance.
          const retryMessages = [
            ...modelMessages,
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: "You did not call a tool. Please call the appropriate tool to answer my previous question.",
                },
              ],
            },
          ];
          const captured2: Array<{ toolName: string; output: unknown }> = [];
          const tools2 = buildTools(captured2);
          const result2 = await generateText({
            model: groq("openai/gpt-oss-120b") as never,
            system: SYSTEM,
            messages: retryMessages,
            tools: tools2,
            stopWhen: stepCountIs(6),
          });
          allCaptured.push(...captured2);
          const check2 = verifyAnswer(result2.text, captured2.map((c) => c.output));
          if (check2.ok) {
            finalText = result2.text;
            numberCheck = { passed: true, unverifiedNumbers: [], reason: "ok" };
          } else {
            const bad = badValues(check2);
            console.warn("reefie: no tool call on retry, unverified numbers:", bad);
            finalText = buildFallbackAnswer(allCaptured);
            numberCheck = { passed: false, unverifiedNumbers: bad, reason: "no_tool_call" };
          }
        } else {
          // Retry once with feedback before falling back.
          const bad = badValues(check1);
          console.warn("reefie: retrying after unverified numbers:", bad);
          const retryMessages = [
            ...modelMessages,
            {
              role: "assistant" as const,
              content: result1.text,
            },
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text:
                    `Your draft contained numbers not in the tool results: ${bad.join(", ")}. ` +
                    `Rewrite the answer using only the exact figures the tools returned. ` +
                    `Do not invent or derive new numbers.`,
                },
              ],
            },
          ];
          const captured3: Array<{ toolName: string; output: unknown }> = [];
          const tools3 = buildTools(captured3);
          const result3 = await generateText({
            model: groq("openai/gpt-oss-120b") as never,
            system: SYSTEM,
            messages: retryMessages,
            tools: tools3,
            stopWhen: stepCountIs(3),
          });
          allCaptured.push(...captured3);
          const check3 = verifyAnswer(result3.text, captured3.map((c) => c.output));
          if (check3.ok && result3.text.trim().length > 0) {
            finalText = result3.text;
            numberCheck = { passed: true, unverifiedNumbers: [], reason: "ok" };
          } else {
            const bad3 = check3.ok ? [] : badValues(check3);
            console.warn("reefie: retry also failed, unverified numbers:", bad3);
            finalText = buildFallbackAnswer(allCaptured);
            numberCheck = {
              passed: false,
              unverifiedNumbers: bad3.length > 0 ? bad3 : bad,
              reason: "number_mismatch",
            };
          }
        }

        return respondWithFinalText(finalText, {
          uiMessages,
          supabase,
          threadId,
          userId,
          numberCheck,
        });
      },
    },
  },
});