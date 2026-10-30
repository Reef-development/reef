/**
 * T9: proves the numbers in a drafted answer before it reaches the user.
 *
 * Skipped at extraction time:
 *   - Years (1900-2100), unless followed by a magnitude suffix or %.
 *   - Tiny integers (0-4), unless followed by a magnitude suffix or %.
 *   - Keys named "id", "*_id", or "*_uuid" — UUID digit runs would otherwise leak
 *     into the known set and let any coincidental number pass.
 */

export type BadNumber = { value: number; raw: string };

export type CheckResult =
  | { ok: true }
  | { ok: false; badNumbers: BadNumber[] };

export type FoundNumber = {
  value: number;
  start: number;
  end: number;
  raw: string;
  scaled: boolean;
  percent: boolean;
};

export type KnownOptions = { scaled?: boolean; percent?: boolean };

const NBSP = "\u00A0";
const NNBSP = "\u202F";

const NUMBER_RE = new RegExp(
  `(?<![\\w])` +
    `(R\\s*)?` +
    `(` +
      `\\d{1,3}(?:[ ${NBSP}${NNBSP},.']\\d{3})*(?:[.,]\\d+)?` +
      `|` +
      `\\d+(?:[.,]\\d+)?` +
    `)` +
    `(\\s*(?:[Bb]illion|[Mm]illion|[Tt]housand)|bn|mn|[MmKk])?` +
    `(?![\\w])`,
  "g",
);

const SUFFIX_MULTIPLIER: Record<string, number> = {
  billion: 1e9,
  bn: 1e9,
  million: 1e6,
  mn: 1e6,
  m: 1e6,
  thousand: 1e3,
  k: 1e3,
};

function suffixMultiplier(suffix: string | undefined): number | null {
  if (!suffix) return null;
  return SUFFIX_MULTIPLIER[suffix.trim().toLowerCase()] ?? null;
}

export function parseFormatted(raw: string): number | null {
  if (!raw) return null;

  let s = raw.replace(new RegExp(`[${NBSP}${NNBSP}\u2019']`, "g"), " ").trim();
  if (!s) return null;

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  const hasSpace = /\s/.test(s);

  if (hasComma && hasDot) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(/,/g, ".");
    } else {
      s = s.replace(/,/g, "");
    }
    s = s.replace(/\s/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  if (hasSpace) {
    const n = Number(s.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  if (hasComma) {
    const parts = s.split(",");
    const grouped = parts.length >= 2 && parts.slice(1).every((p) => /^\d{3}$/.test(p));
    if (grouped) {
      const n = Number(parts.join(""));
      return Number.isFinite(n) ? n : null;
    }
    const n = Number(parts.join("."));
    return Number.isFinite(n) ? n : null;
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function extractNumbers(text: string): FoundNumber[] {
  const out: FoundNumber[] = [];
  if (!text) return out;

  NUMBER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMBER_RE.exec(text)) !== null) {
    const numberPart = m[2];
    const suffix = m[3];

    let value = parseFormatted(numberPart);
    if (value === null || !Number.isFinite(value)) continue;

    const mult = suffixMultiplier(suffix);
    const scaled = mult !== null;
    if (scaled) value *= mult;

    const end = m.index + m[0].length;
    const percent = /^\s?(%|percent\b)/i.test(text.slice(end));

    if (!scaled) {
      if (Number.isInteger(value) && value >= 1900 && value <= 2100 && !percent) continue;
      if (Number.isInteger(value) && Math.abs(value) <= 4 && !percent) continue;
    }

    out.push({
      value,
      start: m.index,
      end,
      raw: numberPart + (suffix ?? ""),
      scaled,
      percent,
    });
  }
  return out;
}

function isIdentifierKey(key: string): boolean {
  const k = key.toLowerCase();
  return k === "id" || k.endsWith("_id") || k.endsWith("_uuid") || k === "uuid";
}

export function collectKnownNumbers(node: unknown, out: Set<number> = new Set()): Set<number> {
  if (node === null || node === undefined) return out;

  if (typeof node === "number") {
    if (Number.isFinite(node)) out.add(node);
    return out;
  }

  if (typeof node === "boolean") return out;

  if (typeof node === "bigint") {
    const v = Number(node);
    if (Number.isFinite(v)) out.add(v);
    return out;
  }

  if (typeof node === "string") {
    // Skip UUID-shaped strings entirely.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(node)) {
      return out;
    }
    for (const { value } of extractNumbers(node)) out.add(value);
    const loose = node.match(/\d+(?:[.,]\d+)?/g);
    if (loose) {
      for (const raw of loose) {
        const v = Number(raw.replace(",", "."));
        if (Number.isFinite(v)) out.add(v);
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
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (isIdentifierKey(k)) continue;
      collectKnownNumbers(v, out);
    }
    return out;
  }

  return out;
}

export function isKnown(value: number, known: Set<number>, opts: KnownOptions = {}): boolean {
  if (!Number.isFinite(value)) return true;
  const v = Math.abs(value);

  if (!opts.scaled && !opts.percent && Number.isInteger(value) && v <= 4) return true;

  const rel = opts.scaled ? 0.01 : 0.005;
  const floor = opts.percent ? 0.5 : 0.01;

  for (const k of known) {
    const kk = Math.abs(k);

    if (v === kk) return true;

    if (Math.abs(kk - v) <= Math.max(floor, kk * rel)) return true;

    if (opts.percent && Math.abs(kk * 100 - v) <= 0.5) return true;
  }

  return false;
}

export function verifyAnswer(answerText: string, toolOutputs: unknown[]): CheckResult {
  const known = new Set<number>();
  for (const output of toolOutputs) collectKnownNumbers(output, known);

  const numbers = extractNumbers(answerText);
  const bad: BadNumber[] = [];
  for (const { value, raw, scaled, percent } of numbers) {
    if (!isKnown(value, known, { scaled, percent })) bad.push({ value, raw });
  }

  return bad.length === 0 ? { ok: true } : { ok: false, badNumbers: bad };
}