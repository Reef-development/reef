/**
 * T9: makes the assistant prove its numbers.
 *
 * After Reefie drafts an answer, every number in that answer must trace back to a figure the
 * data tools actually returned this turn. Anything that doesn't match is treated as invented,
 * even if it looks plausible: a hallucinated number that happens to be "close" to a real one is
 * exactly the failure mode this exists to catch.
 *
 * This file has no dependency on the AI gateway, Supabase, or the request/response cycle, so it
 * can be tested with plain fixtures (see test/number-proof.test.ts).
 */

/** A number pulled out of the assistant's answer, with where it came from for the fallback note. */
export type ExtractedNumber = {
  value: number;
  raw: string;
};

/** Recognises currency (R1 234.56), plain numbers, decimals and percentages. Ignores bare years
 *  in four-digit form only when they look like a calendar year (2000-2099) written with no
 *  decimal, currency sign or percent sign, since those are dates the model is allowed to state
 *  on its own (e.g. "as of 2026") rather than figures it owes the data for. */
const NUMBER_PATTERN =
  /R\s?-?\d[\d\s,]*(?:\.\d+)?|-?\d[\d\s,]*(?:\.\d+)?\s?%|-?\d[\d\s,]*\.\d+|-?\d{1,3}(?:[ ,]\d{3})+|-?\d+/g;

function looksLikeBareCalendarYear(raw: string): boolean {
  return /^\d{4}$/.test(raw.trim()) && Number(raw) >= 2000 && Number(raw) <= 2099;
}

export function extractNumbers(text: string): ExtractedNumber[] {
  const found: ExtractedNumber[] = [];
  const matches = text.match(NUMBER_PATTERN) ?? [];
  for (const raw of matches) {
    if (looksLikeBareCalendarYear(raw)) continue;
    const isPercent = raw.trim().endsWith("%");
    const cleaned = raw.replace(/[R%]/g, "").replace(/[\s,]/g, "").trim();
    if (cleaned === "" || cleaned === "-") continue;
    const value = Number(cleaned);
    if (!Number.isFinite(value)) continue;
    found.push({ value: isPercent ? value : value, raw });
  }
  return found;
}

/** Walks any JSON-shaped tool output and collects every number it contains, plus the length of
 *  every array (so "you have 3 items below reorder point" checks out against low_stock.length
 *  even though 3 itself never appears as a field value). */
export function collectKnownNumbers(toolOutputs: unknown[]): number[] {
  const known: number[] = [];
  const seen = new Set<unknown>();

  function walk(node: unknown) {
    if (node === null || node === undefined) return;
    if (typeof node === "number" && Number.isFinite(node)) {
      known.push(node);
      return;
    }
    if (typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      known.push(node.length);
      for (const item of node) walk(item);
      return;
    }
    for (const value of Object.values(node as Record<string, unknown>)) walk(value);
  }

  for (const output of toolOutputs) walk(output);
  return known;
}

export type VerifyResult = { ok: true } | { ok: false; badNumbers: ExtractedNumber[] };

/** A number counts as backed by the data if it's within rounding distance of something the
 *  tools actually returned: 1 cent absolute, or 0.5% relative for larger figures, whichever is
 *  bigger. This covers currency formatting (R1 234.56 vs 1234.5600000001) and percentages
 *  rounded for display (45% vs 44.6) without letting a genuinely wrong number slip through. */
function isBackedByData(value: number, known: number[]): boolean {
  const tolerance = Math.max(0.01, Math.abs(value) * 0.005);
  return known.some((k) => Math.abs(k - value) <= tolerance);
}

/** 0 and 1 are exempt: they show up constantly in ordinary prose ("no items", "one purchase
 *  order") in ways that don't always map cleanly onto a specific field, and a wrong 0 or 1 is
 *  low-stakes compared to a wrong quantity or rand figure. Everything else is checked. */
function isExempt(n: ExtractedNumber): boolean {
  return n.value === 0 || n.value === 1;
}

export function verifyAnswer(answerText: string, toolOutputs: unknown[]): VerifyResult {
  const known = collectKnownNumbers(toolOutputs);
  const claimed = extractNumbers(answerText);
  const badNumbers = claimed.filter((n) => !isExempt(n) && !isBackedByData(n.value, known));
  if (badNumbers.length === 0) return { ok: true };
  return { ok: false, badNumbers };
}
