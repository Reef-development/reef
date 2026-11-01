/**
 * Reefie generation loop.
 * Save as: web/src/lib/reefie/run-reefie.ts
 *
 * Replaces the three copy-pasted generateText blocks at the end of chat.ts with one function that:
 *  - applies reliable model settings (low temperature, medium reasoning, enough output tokens)
 *  - forces a tool call on the first step for data questions (via prepareStep, so the model can
 *    still write a final answer on later steps)
 *  - lets advice / drafting / greetings through without a tool call
 *  - survives Groq errors (rate limits, malformed tool calls) with one retry and a friendly message
 *  - verifies every number against the tool output, retries once with feedback, then falls back
 */
import { generateText, stepCountIs, type ModelMessage, type ToolSet } from "ai";
import { verifyAnswer, type CheckResult } from "@/lib/reefie/number-proof";
import { buildFallbackAnswer } from "@/lib/reefie/fallback-template";

export type Captured = { toolName: string; output: unknown };

export type NumberCheck = {
  passed: boolean;
  unverifiedNumbers: number[];
  reason: "ok" | "number_mismatch" | "out_of_scope" | "no_tool_call";
};

type Model = Parameters<typeof generateText>[0]["model"];

export type RunArgs = {
  model: Model;
  system: string;
  messages: ModelMessage[];
  /** Must build a fresh tool set that pushes every tool result into `captured`. */
  buildTools: (captured: Captured[]) => ToolSet;
  lastUserText: string;
};

const MODEL_SETTINGS = {
  temperature: 0.1,
  maxOutputTokens: 2048, // reasoning tokens count toward this, so do not set it low
  providerOptions: { groq: { reasoningEffort: "medium" } },
} as const;

const DATA_INTENT =
  /\b(stock|inventory|staff|employees?|headcount|workers?|crew|maintenance|equipment|production|tonnes?|tons?|costs?|spend|downtime|purchase|orders?|suppliers?|fuel|shifts?|reimburse\w*|mines?|sites?|report|summary)\b/i;

export function needsData(text: string): boolean {
  return DATA_INTENT.test(text);
}

const UNAVAILABLE =
  "Reefie could not reach the AI service just now. Please try again in a moment.";

function badValues(check: CheckResult): number[] {
  return check.ok ? [] : check.badNumbers.map((n) => n.value);
}

async function generate(
  args: RunArgs,
  messages: ModelMessage[],
  opts: { forceToolFirst: boolean; maxSteps: number },
) {
  const captured: Captured[] = [];
  try {
    const result = await generateText({
      model: args.model,
      system: args.system,
      messages,
      tools: args.buildTools(captured),
      stopWhen: stepCountIs(opts.maxSteps),
      prepareStep: ({ stepNumber }) =>
        opts.forceToolFirst && stepNumber === 0 ? { toolChoice: "required" as const } : undefined,
      ...MODEL_SETTINGS,
    });
    return { ok: true as const, text: result.text.trim(), captured };
  } catch (error) {
    console.error("reefie: model call failed", error);
    return { ok: false as const, text: "", captured };
  }
}

export async function runReefie(
  args: RunArgs,
): Promise<{ finalText: string; numberCheck: NumberCheck | null }> {
  const needs = needsData(args.lastUserText);
  const everything: Captured[] = [];

  // Attempt 1 (one automatic retry if the provider call itself failed).
  let r = await generate(args, args.messages, { forceToolFirst: needs, maxSteps: 6 });
  if (!r.ok) r = await generate(args, args.messages, { forceToolFirst: needs, maxSteps: 6 });
  if (!r.ok) return { finalText: UNAVAILABLE, numberCheck: null };
  everything.push(...r.captured);

  // Advice, drafting and greetings: no tool needed.
  if (!needs && r.captured.length === 0 && r.text) {
    return { finalText: r.text, numberCheck: { passed: true, unverifiedNumbers: [], reason: "ok" } };
  }

  // Data question answered without a tool: force one.
  if (r.captured.length === 0) {
    const forced = await generate(args, args.messages, { forceToolFirst: true, maxSteps: 6 });
    if (forced.ok) {
      everything.push(...forced.captured);
      r = forced;
    }
    if (!forced.ok || forced.captured.length === 0) {
      return {
        finalText: buildFallbackAnswer(everything),
        numberCheck: { passed: false, unverifiedNumbers: [], reason: "no_tool_call" },
      };
    }
  }

  // Verify every number in the answer against what the tools returned.
  const check = verifyAnswer(r.text, r.captured.map((c) => c.output));
  if (check.ok && r.text) {
    return { finalText: r.text, numberCheck: { passed: true, unverifiedNumbers: [], reason: "ok" } };
  }

  // One retry with feedback about the bad numbers.
  const bad = badValues(check);
  console.warn("reefie: retrying after unverified numbers:", bad);
  const retryMessages: ModelMessage[] = [
    ...args.messages,
    { role: "assistant", content: r.text },
    {
      role: "user",
      content:
        `Your draft contained numbers not in the tool results: ${bad.join(", ")}. ` +
        `Rewrite the answer using only the exact figures the tools returned. ` +
        `Do not invent or derive new numbers.`,
    },
  ];
  const r2 = await generate(args, retryMessages, { forceToolFirst: false, maxSteps: 3 });
  if (r2.ok) {
    everything.push(...r2.captured);
    const check2 = verifyAnswer(r2.text, r2.captured.map((c) => c.output));
    if (check2.ok && r2.text) {
      return {
        finalText: r2.text,
        numberCheck: { passed: true, unverifiedNumbers: [], reason: "ok" },
      };
    }
    const bad2 = badValues(check2);
    return {
      finalText: buildFallbackAnswer(everything),
      numberCheck: {
        passed: false,
        unverifiedNumbers: bad2.length > 0 ? bad2 : bad,
        reason: "number_mismatch",
      },
    };
  }

  return {
    finalText: buildFallbackAnswer(everything),
    numberCheck: { passed: false, unverifiedNumbers: bad, reason: "number_mismatch" },
  };
}