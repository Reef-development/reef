import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, stepCountIs, tool, type UIMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

type ChatBody = { messages?: unknown; threadId?: unknown };

const SYSTEM = `You are Reefie, the operations assistant for R.E.E.F (Resource Energy Engineering Fuels),
a South African contract mining services company (est. 2014, head office Farm 43 Hekpoort, crews across Mpumalanga mines).

You help the owner and managers with three things:
1. Answering questions about their live operational data (stock, maintenance, production, costs, downtime, purchase orders).
2. Practical mining operations advice (maintenance planning, wear-and-tear, cost control, magnetite usage, overtime).
3. Drafting reports and monthly performance summaries.

Rules:
- Always call the data tools before quoting any number. Never invent figures.
- Currency is South African Rand; format as R1 234.56. Tonnes are metric.
- Cost per ton (R/t) = total costs (static + variable) / tonnes produced for the period.
- Be concise, practical and direct. Use markdown: short headings, bullets, small tables.
- If data is missing, say so plainly and suggest what to capture.`;

function userClient(token: string) {
  return createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"]!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
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

        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        // persist the latest user message
        const uiMessages = messages as UIMessage[];
        const last = uiMessages[uiMessages.length - 1];
        if (last && last.role === "user") {
          const { error } = await supabase.from("reefie_messages").insert({
            thread_id: threadId,
            user_id: userId,
            role: "user",
            message: last as unknown as Record<string, unknown>,
          });
          if (error) console.error("reefie: failed to save user message", error);

          if (!thread.title || thread.title === "New conversation") {
            const text = last.parts
              .map((p) => (p.type === "text" ? p.text : ""))
              .join(" ")
              .trim()
              .slice(0, 60);
            if (text) await supabase.from("reefie_threads").update({ title: text }).eq("id", threadId);
          }
        }

        const num = (v: unknown) => Number(v ?? 0);

        const tools = {
          inventory_status: tool({
            description: "Stock levels, items at or below reorder point, total inventory value, and open purchase orders.",
            inputSchema: z.object({}),
            execute: async () => {
              const [{ data: items }, { data: pos }] = await Promise.all([
                supabase.from("stock_items").select("name, sku, unit, qty_on_hand, reorder_point, reorder_qty, unit_cost"),
                supabase.from("purchase_orders").select("id, status, total_cost, created_at").order("created_at", { ascending: false }).limit(25),
              ]);
              const list = items ?? [];
              return {
                total_items: list.length,
                inventory_value: list.reduce((s, i) => s + num(i.qty_on_hand) * num(i.unit_cost), 0),
                low_stock: list.filter((i) => num(i.qty_on_hand) <= num(i.reorder_point)),
                purchase_orders: pos ?? [],
              };
            },
          }),
          maintenance_status: tool({
            description: "Recent repairs, maintenance spend, overdue services and equipment wear/life remaining.",
            inputSchema: z.object({ days: z.number().optional().describe("Look-back window in days, default 90") }),
            execute: async ({ days }) => {
              const since = new Date(Date.now() - (days ?? 90) * 864e5).toISOString().slice(0, 10);
              const today = new Date().toISOString().slice(0, 10);
              const [{ data: logs }, { data: equip }, { data: down }] = await Promise.all([
                supabase.from("maintenance_logs").select("date, description, total_cost, labour_cost, parts_cost, downtime_hours, next_due_date, performed_by, equipment_id").gte("date", since).order("date", { ascending: false }),
                supabase.from("equipment").select("id, name, type, status, tons_since_install, expected_life_tons, hours_since_install, expected_life_hours, replacement_cost, mine_id"),
                supabase.from("downtime_events").select("reason, start_time, duration_hours, estimated_cost").gte("start_time", since).order("start_time", { ascending: false }).limit(50),
              ]);
              const eq = equip ?? [];
              return {
                window_days: days ?? 90,
                maintenance_spend: (logs ?? []).reduce((s, l) => s + num(l.total_cost), 0),
                repairs: logs ?? [],
                overdue: (logs ?? []).filter((l) => l.next_due_date && l.next_due_date <= today),
                equipment: eq.map((e) => ({
                  ...e,
                  life_used_pct: num(e.expected_life_tons) > 0 ? Math.round((num(e.tons_since_install) / num(e.expected_life_tons)) * 100) : null,
                })),
                downtime: down ?? [],
              };
            },
          }),
          production_and_costs: tool({
            description: "Tonnes produced, variable costs (magnetite, overtime, maintenance), static costs and rand-per-ton by month and by mine.",
            inputSchema: z.object({ months: z.number().optional().describe("Look-back window in months, default 6") }),
            execute: async ({ months }) => {
              const from = new Date();
              from.setMonth(from.getMonth() - (months ?? 6));
              const since = from.toISOString().slice(0, 10);
              const [{ data: prod }, { data: statics }, { data: logs }, { data: mines }, { data: clients }] = await Promise.all([
                supabase.from("production_logs").select("date, mine_id, tons_produced, magnetite_used, magnetite_cost, overtime_hours, overtime_cost").gte("date", since).order("date", { ascending: false }),
                supabase.from("static_costs").select("month, mine_id, category, amount").gte("month", since),
                supabase.from("maintenance_logs").select("date, total_cost, equipment_id").gte("date", since),
                supabase.from("mines").select("id, name, client_id, team_name, location, target_cost_per_ton, active"),
                supabase.from("clients").select("id, name, active, contract_revenue_monthly"),
              ]);
              const tons = (prod ?? []).reduce((s, p) => s + num(p.tons_produced), 0);
              const variable = (prod ?? []).reduce((s, p) => s + num(p.magnetite_cost) + num(p.overtime_cost), 0);
              const maint = (logs ?? []).reduce((s, l) => s + num(l.total_cost), 0);
              const fixed = (statics ?? []).reduce((s, c) => s + num(c.amount), 0);
              return {
                window_months: months ?? 6,
                total_tons: tons,
                variable_costs: variable,
                maintenance_costs: maint,
                static_costs: fixed,
                cost_per_ton: tons > 0 ? (variable + maint + fixed) / tons : null,
                production_logs: prod ?? [],
                static_cost_lines: statics ?? [],
                mines: mines ?? [],
                clients: clients ?? [],
              };
            },
          }),
        };

        const gateway = createLovableAiGatewayProvider(key);
        const result = streamText({
          model: gateway("openai/gpt-5.6-sol"),
          system: SYSTEM,
          messages: await convertToModelMessages(uiMessages),
          tools,
          stopWhen: stepCountIs(6),
          providerOptions: { lovable: { reasoningEffort: "none" } },
        });

        return result.toUIMessageStreamResponse({
          originalMessages: uiMessages,
          onFinish: async ({ responseMessage }) => {
            const { error } = await supabase.from("reefie_messages").insert({
              thread_id: threadId,
              user_id: userId,
              role: "assistant",
              message: responseMessage as unknown as Record<string, unknown>,
            });
            if (error) console.error("reefie: failed to save assistant message", error);
            await supabase.from("reefie_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
          },
        });
      },
    },
  },
});