/**
 * T9's checklist requires: "A manager asking the assistant to compare sites is still refused,
 * as before." I couldn't find this refusal anywhere in the existing codebase, system prompt, or
 * any doc in the repo while building this — so this file treats it as NEW, not a re-check of
 * something that already exists. FLAG FOR BRADLEY / WHOEVER OWNS T9: confirm this is the
 * intended rule and wording, or point me at where the real one lives and I'll wire that in
 * instead and delete this file.
 *
 * Best guess at the reasoning, since REEF serves multiple mining clients: different mines
 * usually belong to different clients, so a side-by-side comparison risks handing one client's
 * manager a readable comparison against another client's site (costs, downtime, output) that
 * they have no right to see. This guard refuses BEFORE any data tool runs, so a comparison
 * request never even reaches the point of fetching another site's figures.
 */

const MINE_COMPARISON_PATTERN =
  /\b(compare|versus|vs\.?|which (site|mine) is (better|worse|cheaper|faster)|rank\b.{0,20}\b(sites|mines))\b/i;
const MULTI_SITE_HINT =
  /\b(site|mine)s?\b.{0,40}\b(and|vs\.?|versus|against)\b.{0,40}\b(site|mine)?/i;

export function isSiteComparisonRequest(userText: string): boolean {
  if (!MINE_COMPARISON_PATTERN.test(userText)) return false;
  // Require some sign that more than one site/mine is actually in play, so "compare this
  // month's cost per ton to target" (a single site against its own target) isn't caught.
  return (
    MULTI_SITE_HINT.test(userText) || /\b(each|all|every)\b.{0,10}\b(site|mine)s?\b/i.test(userText)
  );
}

export const SITE_COMPARISON_REFUSAL =
  "I can't compare figures across different sites, since sites usually belong to different clients and a side-by-side comparison could expose one client's numbers to another. I can give you the figures for one site at a time.";
