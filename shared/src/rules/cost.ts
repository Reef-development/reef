/**
 * Rand per ton for a site or a period, or null when nothing was produced. Dividing by zero
 * tons has no meaningful answer, and showing it as R0 would read as "free", the opposite of
 * the truth, so the screens show "No production" instead.
 */
export function costPerTon(totalCost: number, tons: number): number | null {
  return tons > 0 ? totalCost / tons : null;
}

/** Sorts cost-per-ton values highest first, with "no production" after every real figure. */
export function byCostPerTonDesc(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return b - a;
}
