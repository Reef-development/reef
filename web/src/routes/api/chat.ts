import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  tool,
  type UIMessage,
} from "ai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createGroq } from "@ai-sdk/groq";
import {
  hasCompareWords,
  isSiteComparisonRequest,
  SITE_COMPARISON_REFUSAL,
} from "@/lib/reefie/site-guard";
import { withDerivedCosts } from "@/lib/reefie/derived-costs";
import { ungroundedTerms } from "@/lib/reefie/scope-guard";
import { buildSystemPrompt } from "@/lib/reefie/system-prompt";
import { runReefie, type Captured, type NumberCheck } from "@/lib/reefie/run-reefie";

type ChatBody = { messages?: unknown; threadId?: unknown };

const MODEL_ID = "openai/gpt-oss-120b";

function env(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

function userClient(token: string) {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? env("SUPABASE_URL");
  const key =
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
    env("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) throw new Error("Supabase environment variables are missing");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

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

/**
 * Wraps a tool so that (a) its output is captured for number verification, and
 * (b) a failed lookup returns an explicit error result instead of throwing.
 * Without (b), a failed query used to look like "0 results" and got quoted as fact.
 */
function makeRecorderFor(captured: Captured[]) {
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
        let output: unknown;
        try {
          output = await def.execute(input);
        } catch (error) {
          console.error(`reefie: tool ${name} failed`, error);
          output = {
            error: "The data for this question could not be loaded right now.",
            _scope: {
              covers: "nothing, because the data lookup failed",
              doesNotCover: ["all data for this question"],
            },
          };
        }
        captured.push({ toolName: name, output });
        return output;
      },
    });
  }
  return { recordTool };
}

/** Throws on a Supabase error so the tool wrapper can report it, instead of treating it as empty. */
function rows<T>(
  res: { data: T[] | null; error: { message: string } | null },
  label: string,
): T[] {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return res.data ?? [];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const monthName = (d: Date) =>
  d.toLocaleString("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" });

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
  const lastMonth = new Date(Date.UTC(y, m - 1, 1));
  const prevFrom = new Date(Date.UTC(y, m - 2 * n, 1));
  const prevUntil = curFrom;
  return {
    since: iso(curFrom),
    until: iso(curUntil),
    prevSince: iso(prevFrom),
    prevUntil: iso(prevUntil),
    named: n === 1 ? monthName(curFrom) : `${monthName(curFrom)} to ${monthName(lastMonth)}`,
  };
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.replace(/^Bearer\s+/i, "");
        if (!token) return new Response("Unauthorized", { status: 401 });

        let supabase: SupabaseClient;
        try {
          supabase = userClient(token);
        } catch (error) {
          console.error("reefie: server misconfigured", error);
          return new Response("Server is not configured", { status: 500 });
        }

        const { data: userData, error: userErr } = await supabase.auth.getUser(token);
        if (userErr || !userData.user) return new Response("Unauthorized", { status: 401 });
        const userId = userData.user.id;

        let body: ChatBody;
        try {
          body = (await request.json()) as ChatBody;
        } catch {
          return new Response("Invalid JSON body", { status: 400 });
        }
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

        // Prefer the server-side variable; fall back to the Vite one for local dev only.
        // VITE_-prefixed vars are inlined into the browser bundle, so in production
        // only GROQ_API_KEY (server-only) should be set.
        const key = env("GROQ_API_KEY") ?? (import.meta.env.VITE_GROQ_API_KEY as string | undefined);
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

        let refuseComparison = lastUserText ? isSiteComparisonRequest(lastUserText) : false;
        if (!refuseComparison && lastUserText && hasCompareWords(lastUserText)) {
          // Comparison wording but no obvious multi-site hint: check against the real mine names.
          const { data: mineRows } = await supabase.from("mines").select("name");
          const mineNames = (mineRows ?? []).map((m) => String(m.name));
          refuseComparison = isSiteComparisonRequest(lastUserText, mineNames);
        }

        if (refuseComparison) {
          return respondWithFinalText(SITE_COMPARISON_REFUSAL, {
            uiMessages,
            supabase,
            threadId,
            userId,
            numberCheck: null,
          });
        }

        const num = (v: unknown) => Number(v ?? 0);

        function buildTools(captured: Captured[]) {
          const { recordTool } = makeRecorderFor(captured);
          return {
            inventory_status: recordTool("inventory_status", {
              description:
                "Stock levels, items at or below reorder point, total inventory value, and the most recent purchase orders (any status). Use for questions about stock, inventory value, low stock, reorder needs, or recent purchase orders.",
              inputSchema: z.object({}),
              execute: async () => {
                const [itemsRes, levelsRes, posRes] = await Promise.all([
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
                const catalogue = rows(itemsRes, "stock_items");
                const stock = rows(levelsRes, "stock_levels");
                const pos = rows(posRes, "purchase_orders");
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
                  inventory_value: round2(totalValue),
                  low_stock: lowStock,
                  purchase_orders: pos.slice(0, 5).map((p) => ({
                    status: p.status,
                    total_cost: p.total_cost,
                  })),
                  _scope: {
                    covers:
                      "stock catalogue, current stock levels per plant, up to 20 items at or below reorder point, and the 5 most recent purchase orders",
                    doesNotCover: [
                      "forecast stock usage",
                      "individual stock movements or issue history",
                      "purchase orders older than the most recent 5",
                      "low-stock items beyond the first 20",
                    ],
                  },
                };
              },
            }),

            maintenance_status: recordTool("maintenance_status", {
              description:
                "Recent repairs, maintenance spend, overdue services and equipment wear/life remaining. Use this for questions about which equipment is closest to end of life, or which equipment needs the most attention.",
              inputSchema: z.object({
                days: z
                  .number()
                  .int()
                  .min(1)
                  .max(365)
                  .optional()
                  .describe("Look-back window in days, default 30"),
              }),
              execute: async ({ days }: { days?: number }) => {
                const windowDays = days ?? 30;
                const since = new Date(Date.now() - windowDays * 864e5)
                  .toISOString()
                  .slice(0, 10);
                const today = new Date().toISOString().slice(0, 10);
                const [logsRes, equipRes, downRes] = await Promise.all([
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
                const logsArr = rows(logsRes, "maintenance_logs");
                const eq = rows(equipRes, "equipment");
                const downArr = rows(downRes, "downtime_events");
                return {
                  window_days: windowDays,
                  maintenance_spend: round2(logsArr.reduce((s, l) => s + num(l.total_cost), 0)),
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
                    covers: `site-wide maintenance spend across all equipment for the last ${windowDays} days, plus a list of the top five machines by life-used percentage and recent downtime events`,
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
                days: z
                  .number()
                  .int()
                  .min(1)
                  .max(365)
                  .optional()
                  .describe("Look-back window in days, default 30"),
                mine_name: z
                  .string()
                  .optional()
                  .describe("Optional: restrict to one mine by name (case-insensitive)"),
              }),
              execute: async ({ days, mine_name }: { days?: number; mine_name?: string }) => {
                const windowDays = days ?? 30;
                const since = new Date(Date.now() - windowDays * 864e5)
                  .toISOString()
                  .slice(0, 10);

                const [eventsRes, minesRes] = await Promise.all([
                  supabase
                    .from("downtime_events")
                    .select("mine_id, reason, duration_hours, estimated_cost, start_time")
                    .gte("start_time", since)
                    .order("start_time", { ascending: false }),
                  supabase.from("mines").select("id, name, location, active"),
                ]);
                const events = rows(eventsRes, "downtime_events");
                const mines = rows(minesRes, "mines");
                const mineById = new Map(mines.map((m) => [m.id, m]));
                const wanted = mine_name?.trim().toLowerCase();

                const byMine: Record<
                  string,
                  { hours: number; cost: number; events: number; reasons: Record<string, number> }
                > = {};

                for (const e of events) {
                  const mine = mineById.get(e.mine_id ?? "");
                  const name = mine?.name ?? "unknown";
                  if (wanted && !name.toLowerCase().includes(wanted)) continue;

                  if (!byMine[name]) byMine[name] = { hours: 0, cost: 0, events: 0, reasons: {} };
                  const h = num(e.duration_hours);
                  byMine[name].hours += h;
                  byMine[name].cost += num(e.estimated_cost);
                  byMine[name].events += 1;
                  const reason = e.reason ?? "unknown";
                  byMine[name].reasons[reason] = (byMine[name].reasons[reason] ?? 0) + h;
                }

                const ranked = Object.entries(byMine)
                  .map(([name, v]) => ({
                    mine: name,
                    hours: round2(v.hours),
                    cost: round2(v.cost),
                    events: v.events,
                    reasons: Object.fromEntries(
                      Object.entries(v.reasons).map(([r, h]) => [r, round2(h)]),
                    ),
                  }))
                  .sort((a, b) => b.hours - a.hours);

                return {
                  window_days: windowDays,
                  filter: mine_name ?? null,
                  total_events: ranked.reduce((s, m) => s + m.events, 0),
                  by_mine: ranked,
                  mines_available: mines.map((m) => m.name),
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
                "Tonnes produced, variable costs (split into magnetite and overtime), maintenance costs, static costs (grouped by category), tonnes per mine, and rand-per-ton for the last N completed calendar months. Also returns the previous N months' totals and the change in cost per ton for comparison.",
              inputSchema: z.object({
                months: z
                  .number()
                  .int()
                  .min(1)
                  .max(24)
                  .optional()
                  .describe("Look-back window in months, default 6"),
              }),
              execute: async ({ months }: { months?: number }) => {
                const n = months ?? 6;
                const win = monthWindow(n);

                const [
                  prodRes,
                  staticsRes,
                  logsRes,
                  minesRes,
                  clientsRes,
                  prevProdRes,
                  prevStaticsRes,
                  prevLogsRes,
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

                const prodArr = rows(prodRes, "production_logs");
                const statics = rows(staticsRes, "static_costs");
                const logs = rows(logsRes, "maintenance_logs");
                const mines = rows(minesRes, "mines");
                const clients = rows(clientsRes, "clients");
                const prevProd = rows(prevProdRes, "production_logs (previous)");
                const prevStatics = rows(prevStaticsRes, "static_costs (previous)");
                const prevLogs = rows(prevLogsRes, "maintenance_logs (previous)");

                const tons = prodArr.reduce((s, p) => s + num(p.tons_produced), 0);
                const variable = prodArr.reduce(
                  (s, p) => s + num(p.magnetite_cost) + num(p.overtime_cost),
                  0,
                );
                const maint = logs.reduce((s, l) => s + num(l.total_cost), 0);
                const fixed = statics.reduce((s, c) => s + num(c.amount), 0);

                const staticByCategory: Record<string, number> = {};
                for (const c of statics) {
                  const k = c.category ?? "uncategorised";
                  staticByCategory[k] = (staticByCategory[k] ?? 0) + num(c.amount);
                }

                let magnetite = 0;
                let overtime = 0;
                for (const p of prodArr) {
                  magnetite += num(p.magnetite_cost);
                  overtime += num(p.overtime_cost);
                }

                const mineName = new Map(mines.map((m) => [m.id, m.name]));
                const tonsByMine: Record<string, number> = {};
                for (const p of prodArr) {
                  const name = mineName.get(p.mine_id ?? "") ?? "unknown";
                  tonsByMine[name] = (tonsByMine[name] ?? 0) + num(p.tons_produced);
                }
                for (const k of Object.keys(tonsByMine)) tonsByMine[k] = round2(tonsByMine[k]);

                const prevTons = prevProd.reduce((s, p) => s + num(p.tons_produced), 0);
                const prevVariable = prevProd.reduce(
                  (s, p) => s + num(p.magnetite_cost) + num(p.overtime_cost),
                  0,
                );
                const prevMaint = prevLogs.reduce((s, l) => s + num(l.total_cost), 0);
                const prevFixed = prevStatics.reduce((s, c) => s + num(c.amount), 0);
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
                if (prevStatics.length === 0) {
                  dataNotes.push(
                    "previous period has no static costs, so cost_per_ton comparison may be misleading",
                  );
                }
                if (prodArr.length === 0) {
                  dataNotes.push("current period has no production rows in the window");
                }

                const derived = withDerivedCosts({
                  window_months: n,
                  window_named: win.named,
                  window_label: `${win.since} to ${win.until} (exclusive)`,
                  previous_window_label: `${win.prevSince} to ${win.prevUntil} (exclusive)`,
                  total_tons: tons,
                  variable_costs: variable,
                  maintenance_costs: maint,
                  static_costs: fixed,
                  mine_count: mines.length,
                  client_count: clients.length,
                  tons_by_mine: tonsByMine,
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

                // Keep any _scope that withDerivedCosts already adds; otherwise supply one.
                const existingScope = (derived as { _scope?: unknown })._scope;
                return {
                  ...derived,
                  _scope: existingScope ?? {
                    covers: `production, variable, maintenance and static costs across all mines for ${win.named} (complete calendar months), compared with the previous ${n} month(s)`,
                    doesNotCover: [
                      "costs per mine (only tonnes are split by mine)",
                      "the current partial month",
                      "revenue, profit or margin",
                    ],
                  },
                };
              },
            }),

            headcount: recordTool("headcount", {
              description:
                "How many employees REEF has, optionally broken down by mine or shift. Use this for questions like 'how many workers do we have', 'how many on the night shift', or 'how many people work at Kangala'. Pass the mine by NAME in mine_name, not by id.",
              inputSchema: z.object({
                mine_name: z
                  .string()
                  .optional()
                  .describe("Limit to one mine by name (case-insensitive, partial match is fine)"),
                mine_id: z.string().uuid().optional().describe("Limit to one mine by id"),
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
                mine_name,
                mine_id,
                shift,
                active_only,
              }: {
                mine_name?: string;
                mine_id?: string;
                shift?: "morning" | "midday" | "night";
                active_only?: boolean;
              }) => {
                const mines = rows(
                  await supabase.from("mines").select("id, name"),
                  "mines",
                );
                const scope = {
                  covers:
                    "current active employee headcount, optionally filtered by mine or shift, with a breakdown by shift and by mine",
                  doesNotCover: [
                    "historical headcount",
                    "individual personnel files or ID numbers",
                    "contractors or sub-contractors",
                  ],
                };

                let resolvedMineId = mine_id;
                let resolvedMineName: string | null = null;
                if (!resolvedMineId && mine_name) {
                  const wanted = mine_name.trim().toLowerCase();
                  const hit =
                    mines.find((m) => m.name.toLowerCase() === wanted) ??
                    mines.find((m) => m.name.toLowerCase().includes(wanted));
                  if (!hit) {
                    return {
                      not_found: mine_name,
                      mines_available: mines.map((m) => m.name),
                      _scope: scope,
                    };
                  }
                  resolvedMineId = hit.id;
                  resolvedMineName = hit.name;
                }

                let q = supabase
                  .from("employees")
                  .select("id, shift, active, mine_id", { count: "exact" });
                if (active_only !== false) q = q.eq("active", true);
                if (resolvedMineId) q = q.eq("mine_id", resolvedMineId);
                if (shift) q = q.eq("shift", shift);
                const { data, count, error } = await q;
                if (error) throw new Error(`employees: ${error.message}`);

                const list = data ?? [];
                const byShift = list.reduce<Record<string, number>>((acc, e) => {
                  const k = e.shift ?? "unknown";
                  acc[k] = (acc[k] ?? 0) + 1;
                  return acc;
                }, {});
                const mineName = new Map(mines.map((m) => [m.id, m.name]));
                const byMine = list.reduce<Record<string, number>>((acc, e) => {
                  const k = mineName.get(e.mine_id ?? "") ?? "unassigned";
                  acc[k] = (acc[k] ?? 0) + 1;
                  return acc;
                }, {});

                return {
                  total: count ?? list.length,
                  by_shift: byShift,
                  by_mine: byMine,
                  mine_filter: resolvedMineName,
                  shift_filter: shift ?? null,
                  _scope: scope,
                };
              },
            }),
          };
        }

        const groq = createGroq({ apiKey: key });
        const modelMessages = await convertToModelMessages(uiMessages.slice(-10));

        // Track every attempt's captured tool outputs so we can run the (log-only) scope check.
        const attempts: Captured[][] = [];

        const { finalText, numberCheck } = await runReefie({
          model: groq(MODEL_ID) as never,
          system: buildSystemPrompt(),
          messages: modelMessages,
          buildTools: (captured) => {
            attempts.push(captured);
            return buildTools(captured);
          },
          lastUserText,
        });

        // Log-only scope check: measure false positives without refusing.
        if (lastUserText) {
          const outputs = attempts.flat().map((c) => c.output);
          const missingTerms = ungroundedTerms(lastUserText, outputs);
          if (missingTerms.length > 0) {
            console.warn("[scope-guard] possible out-of-scope terms:", missingTerms);
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