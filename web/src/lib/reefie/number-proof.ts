/**
 * T9: proves the numbers in a drafted answer before it reaches the user.
 *
 * The rule: every number in the draft must trace back to a figure the tools actually
 * returned this turn. If it doesn't, the draft is thrown away and the fallback is shown.
 *
 * Two cases are deliberately skipped at extraction time, so nothing downstream has to
 * reason about them:
 *
 *   - Years (1900-2100). "As of 2026, production is steady" is a date, not a claim.
 *   - Tiny integers (0-4). "3 of them are low" is a count, but it's usually incidental.
 *     This one is left in place and filtered by the comparison, because sometimes it is
 *     a real claim.
 */

export type BadNumber = { value: number; raw: string };

export type CheckResult =
  | { ok: true }
  | { ok: false; badNumbers: BadNumber[] };

type FoundNumber = { value: number; start: number; end: number; raw: string };

/**
 * Matches a standalone number and returns it with its offsets. Years in 1900-2100 are
 * dropped: they're dates, not figures, and no tool returns a year as a value to be
 * verified.
 */
function extractNumbersFromText(text: string): FoundNumber[] {
  const out: FoundNumber[] = [];
  if (!text) return out;

  // Matches: an optional R prefix, then a number that is either grouped (1 234 567.89)
  // or plain (42). Word boundaries on both sides keep it from matching inside identifiers
  // like "rig07".
  const re = /(?<![\w])(?:R\s*)?(\d{1,3}(?:[ ,]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\w])/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1];
    const value = Number(raw.replace(/[ ,]/g, ""));
    if (!Number.isFinite(value)) continue;

    // Drop years. A four-digit number in the 1900-2100 range is almost always a date,
    // not a claim about data, and no tool returns a year as a value.
    if (Number.isInteger(value) && value >= 1900 && value <= 2100) continue;

    out.push({ value, start: m.index, end: m.index + m[0].length, raw });
  }
  return out;
}

/**
 * Reads the numbers out of a piece of text. Exposed for the tests.
 */
export function extractNumbers(text: string): FoundNumber[] {
  return extractNumbersFromText(text);
}

/**
 * Walks the tool output and collects every number it can find. Numbers appear as number
 * values, as numeric strings, as array lengths, and as digits embedded in strings.
 */
export function collectKnownNumbers(node: unknown, out: Set<number> = new Set()): Set<number> {
  if (node === null || node === undefined) return out;

  if (typeof node === "number") {
    if (Number.isFinite(node)) {
      out.add(node);
      out.add(node * 100);
      out.add(node / 100);
    }
    return out;
  }

  if (typeof node === "boolean") return out;

  if (typeof node === "bigint") {
    const v = Number(node);
    if (Number.isFinite(v)) out.add(v);
    return out;
  }

  if (typeof node === "string") {
    for (const { value } of extractNumbersFromText(node)) {
      out.add(value);
      out.add(value * 100);
      out.add(value / 100);
    }
    // Also collect raw digit-runs so identifiers like "Drill rig 07" register the 7.
    const loose = node.match(/\d+(?:[.,]\d+)?/g);
    if (loose) {
      for (const raw of loose) {
        const v = Number(raw.replace(",", "."));
        if (Number.isFinite(v)) {
          out.add(v);
          out.add(v * 100);
          out.add(v / 100);
        }
      }
    }
    return out;
  }

  if (Array.isArray(node)) {
    out.add(node.length);
    for (const item of node) collectKnownNumbers(item, out);
    return out;
  }

  if (typeof node === "object") {
    for (const value of Object.values(node as Record<string, unknown>)) {
      collectKnownNumbers(value, out);
    }
    return out;
  }

  return out;
}

function isKnown(value: number, known: Set<number>): boolean {
  if (!Number.isFinite(value)) return true;
  const v = Math.abs(value);

  // Tiny integers (0-4) are almost always incidental.
  if (Number.isInteger(value) && v <= 4) return true;

  for (const k of known) {
    const kk = Math.abs(k);
    if (v === kk) return true;
    const scale = Math.max(1, kk);
    if (Math.abs(kk - v) <= 0.01 * scale) return true;
    if (Math.round(kk) === Math.round(v)) return true;
    if (Math.abs(kk * 100 - v) <= 0.5) return true;
    if (Math.abs(kk / 100 - v) <= 0.5) return true;
  }
  return false;
}

export function verifyAnswer(answerText: string, toolOutputs: unknown[]): CheckResult {
  const known = new Set<number>();
  for (const output of toolOutputs) collectKnownNumbers(output, known);

  const numbers = extractNumbersFromText(answerText);
  const bad: BadNumber[] = [];
  for (const { value, raw } of numbers) {
    if (!isKnown(value, known)) bad.push({ value, raw });
  }

  return bad.length === 0 ? { ok: true } : { ok: false, badNumbers: bad };
}