import type { AskInput, AssistantAnswer, Figure } from "@reef/shared";
import type { AnalyticsRepository, Period } from "../repositories/types.js";
import { ApiError } from "../http/errors.js";
import { costPerTon, rankByCostPerTon } from "./cost.js";
import { unverifiedNumbers } from "./number-check.js";

/**
 * Reefie, the plain-language assistant (FR-31, FR-32, FR-33).
 *
 * HOW THE THREE REQUIREMENTS ARE ACTUALLY MET
 *
 * FR-31, ask in plain language: the question is matched to one of a closed set of intents by
 * keyword. Keywords rather than a model, because the match decides which figures are fetched,
 * and an authorisation-relevant branch should not vary between two identical questions.
 *
 * FR-32, answer only from recorded data: the figures are read from the database FIRST, the
 * sentence is written from those figures only, and then every number in the sentence is
 * checked back against them. Anything that does not match means the sentence is thrown away
 * and the figures are listed plainly instead, with the reader told that happened. So there is
 * no path by which a number the records do not contain can reach a reader unremarked, even if
 * a language model is put behind this later.
 *
 * FR-33, no wider view than the asker already has: the figures are read through the same
 * repositories, carrying the caller's own token, that every other endpoint uses. The assistant
 * has no privileged path to data, so it cannot become a way around the permission table.
 */

export type Intent = "cost_per_ton" | "comparison" | "production" | "downtime" | "unsupported";

export function classify(question: string): Intent {
  const q = question.toLowerCase();
  const has = (...words: string[]) => words.some((w) => q.includes(w));

  const comparing = has(
    "compare",
    "comparison",
    "which site",
    "which mine",
    "cheapest",
    "best site",
    "worst site",
  );
  if (comparing) return "comparison";
  if (has("cost per ton", "cost a ton", "unit cost", "what did it cost", "running cost"))
    return "cost_per_ton";
  if (has("downtime", "stoppage", "stopped", "breakdown", "lost hours")) return "downtime";
  if (has("production", "tons", "tonnage", "output", "produced")) return "production";
  return "unsupported";
}

/** A period the question did not give: the last thirty days, stated in the answer. */
export function defaultPeriod(today: Date = new Date()): Period {
  const to = today.toISOString().slice(0, 10);
  const from = new Date(today.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

function rands(value: number): string {
  return `R ${value.toFixed(2)}`;
}

export async function answer(
  analytics: AnalyticsRepository,
  input: AskInput,
  canCompare: boolean,
  today: Date = new Date(),
): Promise<AssistantAnswer> {
  const intent = classify(input.question);
  const period: Period =
    input.from && input.to ? { from: input.from, to: input.to } : defaultPeriod(today);
  const scope = `${period.from} to ${period.to}`;

  if (intent === "unsupported") {
    return {
      intent,
      scope,
      figures: [],
      discarded: false,
      answer:
        "I can answer questions about cost per ton, production, downtime, and how sites " +
        "compare. Ask one of those and I will read the figures out of the records.",
    };
  }

  // FR-33 in one line: comparing sites is refused here for the same reason, and by the same
  // permission, as at the comparison endpoint. Answering it "just for your own sites" would
  // answer a question the asker did not ask and is not allowed to ask.
  if (intent === "comparison" && !canCompare) {
    throw new ApiError(
      "FORBIDDEN",
      "Comparing sites against each other is the owner's view. Ask about one of your own sites instead",
    );
  }

  const mines = await analytics.mines();
  if (mines.length === 0) {
    return {
      intent,
      scope,
      figures: [],
      discarded: false,
      answer: "There are no sites you can see, so there is nothing to report on.",
    };
  }

  const chosen = input.mine_id ? mines.find((m) => m.id === input.mine_id) : mines[0];
  if (!chosen) throw new ApiError("NOT_FOUND", "That site does not exist or has been removed");

  const figures: Figure[] = [];
  const sentences: string[] = [];

  if (intent === "comparison") {
    const rows = rankByCostPerTon(
      await Promise.all(mines.map((mine) => costPerTon(analytics, mine, period))),
    );
    for (const row of rows) {
      figures.push({
        label: `${row.mine_name} cost per ton`,
        value: row.cost_per_ton === null ? "no production" : rands(row.cost_per_ton),
      });
      figures.push({ label: `${row.mine_name} tons`, value: row.tons_produced.toFixed(2) });
    }
    const withFigure = rows.filter((r) => r.cost_per_ton !== null);
    if (withFigure.length === 0) {
      sentences.push(`No site recorded any production between ${period.from} and ${period.to}.`);
    } else {
      const best = withFigure[0]!;
      sentences.push(
        `Between ${period.from} and ${period.to}, ${best.mine_name} was the cheapest at ` +
          `${rands(best.cost_per_ton!)} per ton.`,
      );
      if (withFigure.length > 1) {
        const worst = withFigure[withFigure.length - 1]!;
        sentences.push(
          `${worst.mine_name} was the dearest at ${rands(worst.cost_per_ton!)} per ton.`,
        );
      }
      const silent = rows.filter((r) => r.cost_per_ton === null);
      if (silent.length > 0) {
        sentences.push(
          `${silent.map((r) => r.mine_name).join(", ")} recorded no production, so no cost per ton can be worked out for them.`,
        );
      }
    }
  }

  if (intent === "cost_per_ton") {
    const row = await costPerTon(analytics, chosen, period);
    figures.push(
      { label: "Tons produced", value: row.tons_produced.toFixed(2) },
      { label: "Fixed costs", value: rands(row.fixed_costs) },
      { label: "Magnetite", value: rands(row.magnetite_cost) },
      { label: "Overtime", value: rands(row.overtime_cost) },
      { label: "Maintenance", value: rands(row.maintenance_cost) },
      { label: "Fuel", value: rands(row.fuel_cost) },
      { label: "Total cost", value: rands(row.total_cost) },
      {
        label: "Cost per ton",
        value: row.cost_per_ton === null ? "no production" : rands(row.cost_per_ton),
      },
    );
    sentences.push(
      row.cost_per_ton === null
        ? `${chosen.name} recorded no production between ${period.from} and ${period.to}, so there is no cost per ton. The costs still ran: ${rands(row.total_cost)} in total.`
        : `${chosen.name} cost ${rands(row.cost_per_ton)} per ton between ${period.from} and ${period.to}, on ${row.tons_produced.toFixed(2)} tons and ${rands(row.total_cost)} of cost.`,
    );
    if (row.cost_per_ton !== null) {
      sentences.push(
        `Of that, ${rands(row.fixed_costs)} was fixed cost and ${rands(row.magnetite_cost + row.overtime_cost + row.maintenance_cost + row.fuel_cost)} was variable.`,
      );
      figures.push({
        label: "Variable costs",
        value: rands(row.magnetite_cost + row.overtime_cost + row.maintenance_cost + row.fuel_cost),
      });
    }
  }

  if (intent === "production") {
    const totals = await analytics.productionTotals(chosen.id, period);
    const byDay = await analytics.productionByDay(chosen.id, period);
    figures.push(
      { label: "Tons produced", value: totals.tons.toFixed(2) },
      { label: "Days with a shift recorded", value: String(totals.days) },
    );
    const best = [...byDay].sort((a, b) => b.tons - a.tons)[0];
    if (best) figures.push({ label: `Best day ${best.date}`, value: best.tons.toFixed(2) });
    sentences.push(
      totals.days === 0
        ? `${chosen.name} has no production recorded between ${period.from} and ${period.to}.`
        : `${chosen.name} produced ${totals.tons.toFixed(2)} tons between ${period.from} and ${period.to}, on ${totals.days} days with a shift recorded.`,
    );
    if (best)
      sentences.push(`The best single day was ${best.date}, at ${best.tons.toFixed(2)} tons.`);
  }

  if (intent === "downtime") {
    const byReason = await analytics.downtimeHours(chosen.id, period);
    const total = byReason.reduce((t, r) => t + r.hours, 0);
    figures.push({ label: "Downtime hours", value: total.toFixed(2) });
    for (const row of byReason) {
      figures.push({
        label: `Downtime, ${row.reason.replace(/_/g, " ")}`,
        value: row.hours.toFixed(2),
      });
    }
    sentences.push(
      byReason.length === 0
        ? `${chosen.name} has no downtime recorded between ${period.from} and ${period.to}.`
        : `${chosen.name} lost ${total.toFixed(2)} hours to downtime between ${period.from} and ${period.to}.`,
    );
    const worst = byReason[0];
    if (worst) {
      sentences.push(
        `The largest single cause was ${worst.reason.replace(/_/g, " ")}, at ${worst.hours.toFixed(2)} hours.`,
      );
    }
  }

  const written = sentences.join(" ");

  // The check itself. Everything the answer is allowed to contain: the figures, their labels,
  // and the period it covers.
  const allowed = [...figures.map((f) => `${f.label} ${f.value}`), scope, chosen.name];
  const invented = unverifiedNumbers(written, allowed);

  if (invented.length > 0) {
    return {
      intent,
      scope,
      figures,
      discarded: true,
      answer:
        "The written answer was put aside because it contained a figure that is not in the " +
        "records. The figures below come straight from them.",
    };
  }

  return { intent, scope, figures, discarded: false, answer: written };
}
