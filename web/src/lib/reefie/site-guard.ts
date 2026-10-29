/**
 * Refuses cross-site comparisons BEFORE any data tool runs.
 *
 * Rationale: REEF serves multiple mining clients, and different mines usually belong to
 * different clients, so a side-by-side comparison could expose one client's costs, downtime
 * or output to another client's manager.
 *
 * A request is refused when it uses comparison wording AND clearly involves more than one site:
 *  - the words "site"/"mine" appear twice ("the Witbank site and the Middelburg site"), or
 *  - two letter/number-named sites ("Mine A ... Mine B"), or
 *  - a plural or "each/all/every/between/across" form ("compare all mines"), or
 *  - two known mine names from the database (pass them as the optional second argument).
 *
 * A single site compared with itself over time ("compare Mine A's cost against last month")
 * is NOT refused.
 */

const COMPARE_WORDS =
  /\b(compare|compared|comparing|comparison|versus|vs\.?|which (site|mine) is (better|worse|cheaper|faster|best|worst)|rank\b.{0,20}\b(sites|mines))\b/i;

const SITE_WORD = /\b(?:site|mine)s?\b/gi;
const PLURAL_OR_ALL =
  /\b(sites|mines)\b|\b(each|all|every|between|across)\b.{0,15}\b(sites?|mines?)\b|\bwhich (site|mine)\b/i;
// Letter/number names like "Mine A", "Site 2". The letter/number must be uppercase or a digit.
const NAMED_SITE = /\b(?:[Mm]ine|[Ss]ite)\s+([A-Z0-9])\b/g;

export function hasCompareWords(userText: string): boolean {
  return COMPARE_WORDS.test(userText);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isSiteComparisonRequest(userText: string, knownMineNames: string[] = []): boolean {
  if (!COMPARE_WORDS.test(userText)) return false;

  if (PLURAL_OR_ALL.test(userText)) return true;
  if ((userText.match(SITE_WORD)?.length ?? 0) >= 2) return true;

  const letters = new Set<string>();
  for (const match of userText.matchAll(NAMED_SITE)) letters.add(match[1]);
  if (letters.size >= 2) return true;

  const lower = userText.toLowerCase();
  const mentioned = knownMineNames.filter(
    (name) =>
      name.trim().length > 2 &&
      new RegExp(`\\b${escapeRegExp(name.trim().toLowerCase())}\\b`).test(lower),
  );
  return new Set(mentioned.map((n) => n.toLowerCase())).size >= 2;
}

export const SITE_COMPARISON_REFUSAL =
  "I can't compare figures across different sites, since sites usually belong to different clients and a side-by-side comparison could expose one client's numbers to another. I can give you the figures for one site at a time.";