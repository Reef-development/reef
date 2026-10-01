
const NUMBER_RUN = /\d[\d\s,.]*\d|\d/g;


const ISO_DATE = /\d{4}-\d{2}(-\d{2})?/g;


const RELATIVE_TOLERANCE = 0.01;

function parseRun(run: string): number | null {
  let text = run.replace(/\s+/g, "").replace(/[.,]$/, "");
  if (text.includes(".") && text.includes(",")) {
    text =
      text.lastIndexOf(".") > text.lastIndexOf(",")
        ? text.replace(/,/g, "")
        : text.replace(/\./g, "").replace(",", ".");
  } else if (text.includes(",")) {
    const tail = text.split(",")[1] ?? "";
    text = tail.length === 3 ? text.replace(/,/g, "") : text.replace(",", ".");
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Every number in a piece of text, with the text that produced it. */
export function numbersIn(text: string): { raw: string; value: number }[] {
  const withoutDates = text.replace(ISO_DATE, " ");
  const found: { raw: string; value: number }[] = [];
  for (const match of withoutDates.match(NUMBER_RUN) ?? []) {
    const value = parseRun(match);
    if (value !== null) found.push({ raw: match.trim(), value });
  }
  return found;
}

function matches(candidate: number, allowed: number): boolean {
  if (candidate === allowed) return true;
  for (const places of [0, 1, 2]) {
    const factor = 10 ** places;
    if (Math.round(allowed * factor) / factor === candidate) return true;
  }
  return Math.abs(candidate - allowed) <= Math.abs(allowed) * RELATIVE_TOLERANCE;
}

/**
 * The numbers in `answer` that are not in `allowed`, written as they appeared. An empty array
 * means every number in the answer came from the records.
 */
export function unverifiedNumbers(answer: string, allowed: string[]): string[] {
  const permitted = numbersIn(allowed.join(" ")).map((n) => n.value);
  const offenders: string[] = [];
  for (const { raw, value } of numbersIn(answer)) {
    // A year is not a figure about the business.
    if (Number.isInteger(value) && value >= 1900 && value <= 2100) continue;
    if (permitted.some((p) => matches(value, p))) continue;
    offenders.push(raw);
  }
  return [...new Set(offenders)];
}
