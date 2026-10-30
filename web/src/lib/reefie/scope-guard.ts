/**
 * A deterministic detector for questions the tools can't answer.
 *
 * Runs AFTER the model has been called, so it has the tool output to compare against.
 * Returns the ORIGINAL content words of the question that the tool outputs don't cover.
 *
 * The caller decides whether to refuse or just log. Default in chat.ts is log-only,
 * so this can run for a week and its false-positive rate measured before it starts
 * refusing real questions.
 */

const STOP_WORDS =
  "how much many did do does done we our us the a an of on in for to is are was were be been " +
  "what why when where which who whom whose this that these those last next current " +
  "month year week day today per and or but with by from at as it its about " +
  "can could should would will has have had you your me my i show tell give get " +
  "please any all some there their than then over under between across " +
  "monthly quarterly weekly daily annual yearly previous prior past future " +
  "change changed changes changing vary varies varied trend trends compare compared comparison " +
  "difference differ different higher lower increase increased increasing decrease decreased " +
  "decreasing rise rose risen fall fell fallen falling drop dropped up down more less " +
  "above below explain explains reason reasons cause causes driver drivers driven " +
  "improve improved improving worse better decline declined";

const DOMAIN_WORDS =
  "spend spent cost costs ton tons tonne tonnes production produced produce maintenance " +
  "static variable mine mines client clients total average rand rands downtime stock " +
  "headcount employee employees machine machines site sitewide breakdown figure number " +
  "shift shifts worker workers staff team teams overhead overheads fuel diesel " +
  "magnetite overtime repair repairs equipment asset assets fleet";

export function stem(w: string): string {
  if (w.length <= 4) return w;
  if (/(ss|us|is)$/.test(w)) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("s")) return w.slice(0, -1);
  return w;
}

const STOP = new Set(STOP_WORDS.split(/\s+/).map(stem));
const DOMAIN = new Set(DOMAIN_WORDS.split(/\s+/).map(stem));

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z]{3,}/g) ?? [];
}

function splitKey(k: string): string {
  return k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
}

function collectWords(node: unknown, out: Set<string>) {
  if (node == null) return;
  if (typeof node === "string") {
    words(node).forEach((w) => out.add(stem(w)));
  } else if (Array.isArray(node)) {
    node.forEach((n) => collectWords(n, out));
  } else if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      words(splitKey(k)).forEach((w) => out.add(stem(w)));
      collectWords(v, out);
    }
  }
}

export function ungroundedTerms(question: string, toolOutputs: unknown[]): string[] {
  const known = new Set<string>(DOMAIN);
  collectWords(toolOutputs, known);

  const originals = words(question);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of originals) {
    const s = stem(w);
    if (STOP.has(s) || known.has(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(w);
  }
  return out;
}