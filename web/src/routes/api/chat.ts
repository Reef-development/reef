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
- For headcount and staff questions, use the headcount tool. Do not guess how many employees REEF has.
- When answering a headcount question, quote only the total and the shift breakdown from the tool result. Do not count names from the employee list.
- For "which equipment is closest to end of life" questions, use the equipment_by_life_used array from the maintenance_status tool. Quote the percentages exactly as returned, in the order returned.
- If a question cannot be answered from the tools you have, say so plainly and suggest what data would need to be captured. Do not invent an answer.
- Currency is South African Rand; format as R1 234.56. Tonnes are metric.
- Cost per ton (R/t) = total costs (static + variable) / tonnes produced for the period.
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

function respondWithFinalText(
  finalText: string,
  opts: {
    uiMessages: UIMessage[];
    supabase: SupabaseClient;
    threadId: string;
    userId: string;
    numberCheck: { passed: boolean; unverifiedNumbers: number[] } | null;
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
        });
        if (checkError) console.error("reefie: failed to log number check", checkError);
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}

/**
 * Extracts the bad number values from a CheckResult, safely across the union. If the
 * check passed, returns an empty array. This avoids narrowing gymnastics in the caller.
 */
function badValues(check: CheckResult): number[] {
  return check.ok ? [] : check.badNumbers.map((n) => n.value);
}

/**
 * The tool recorder. Parameters use `any` so the SDK infers the tool type from the call
 * site rather than from a generic that it can't reconcile.
 */
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

        const key = import.meta.env.VITE_GROQ_API_KEY as string | undefined;
        if (!key) return new Response("Missing VITE_GROQ_API_KEY", { status: 500 });

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
                    id: p.id,
                    status: p.status,
                    total_cost: p.total_cost,
                  })),
                };
              },
            }),
            maintenance_status: recordTool("maintenance_status", {
              description:
                "Recent repairs, maintenance spend, overdue services and equipment wear/life remaining. Use this for questions about which equipment is closest to end of life, or which equipment needs the most attention.",
              inputSchema: z.object({
                days: z.number().optional().describe("Look-back window in days, default 90"),
              }),
              execute: async ({ days }: { days?: number }) => {
                const since = new Date(Date.now() - (days ?? 90) * 864e5)
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
                  window_days: days ?? 90,
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
                };
              },
            }),
            production_and_costs: recordTool("production_and_costs", {
              description:
                "Tonnes produced, variable costs (magnetite, overtime, maintenance), static costs and rand-per-ton by month and by mine.",
              inputSchema: z.object({
                months: z.number().optional().describe("Look-back window in months, default 6"),
              }),
              execute: async ({ months }: { months?: number }) => {
                const from = new Date();
                from.setMonth(from.getMonth() - (months ?? 6));
                const since = from.toISOString().slice(0, 10);
                const [
                  { data: prod },
                  { data: statics },
                  { data: logs },
                  { data: mines },
                  { data: clients },
                ] = await Promise.all([
                  supabase
                    .from("production_logs")
                    .select(
                      "date, mine_id, tons_produced, magnetite_used, magnetite_cost, overtime_hours, overtime_cost",
                    )
                    .gte("date", since),
                  supabase
                    .from("static_costs")
                    .select("month, mine_id, category, amount")
                    .gte("month", since),
                  supabase
                    .from("maintenance_logs")
                    .select("date, total_cost, equipment_id")
                    .gte("date", since),
                  supabase.from("mines").select("id, name, team_name, location, active"),
                  supabase.from("clients").select("id, name, active, contract_revenue_monthly"),
                ]);
                const prodArr = prod ?? [];
                const tons = prodArr.reduce((s, p) => s + num(p.tons_produced), 0);
                const variable = prodArr.reduce(
                  (s, p) => s + num(p.magnetite_cost) + num(p.overtime_cost),
                  0,
                );
                const maint = (logs ?? []).reduce((s, l) => s + num(l.total_cost), 0);
                const fixed = (statics ?? []).reduce((s, c) => s + num(c.amount), 0);
                return {
                  window_months: months ?? 6,
                  total_tons: tons,
                  variable_costs: variable,
                  maintenance_costs: maint,
                  static_costs: fixed,
                  cost_per_ton: tons > 0 ? (variable + maint + fixed) / tons : null,
                  mine_count: (mines ?? []).length,
                  client_count: (clients ?? []).length,
                };
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
                  .select(
                    "id, full_name, employee_no, position, shift, team_name, mine_id, active",
                    { count: "exact" },
                  );
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
                  employees: list.slice(0, 3),
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
          model: groq("qwen/qwen3.8-27b") as never,
          system: SYSTEM,
          messages: modelMessages,
          tools: tools1,
          stopWhen: stepCountIs(6),
        });

        const check1 = verifyAnswer(result1.text, captured1.map((c) => c.output));

        let finalText: string;
        let numberCheck: { passed: boolean; unverifiedNumbers: number[] };
        const allCaptured = [...captured1];

        if (check1.ok && captured1.length > 0) {
          finalText = result1.text;
          numberCheck = { passed: true, unverifiedNumbers: [] };
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
            model: groq("qwen/qwen3.8-27b") as never,
            system: SYSTEM,
            messages: retryMessages,
            tools: tools2,
            stopWhen: stepCountIs(6),
          });
          allCaptured.push(...captured2);
          const check2 = verifyAnswer(result2.text, captured2.map((c) => c.output));
          if (check2.ok) {
            finalText = result2.text;
            numberCheck = { passed: true, unverifiedNumbers: [] };
          } else {
            const bad = badValues(check2);
            console.warn("reefie: threw away a drafted answer, unverified numbers:", bad);
            finalText = buildFallbackAnswer(allCaptured);
            numberCheck = { passed: false, unverifiedNumbers: bad };
          }
        } else {
          const bad = badValues(check1);
          console.warn("reefie: threw away a drafted answer, unverified numbers:", bad);
          finalText = buildFallbackAnswer(captured1);
          numberCheck = { passed: false, unverifiedNumbers: bad };
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