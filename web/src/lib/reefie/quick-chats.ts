import { useCallback, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";

export const CATEGORIES = [
  "Stock",
  "Equipment",
  "Maintenance",
  "Production",
  "Costs",
  "Downtime",
  "People",
  "Reports",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type QuickChat = { id: string; category: Category; text: string; custom?: boolean };

const p = (id: string, category: Category, text: string): QuickChat => ({ id, category, text });

export const PRESETS: QuickChat[] = [
  p("stock-reorder", "Stock", "What stock is below reorder point right now?"),
  p("stock-value", "Stock", "What is our total inventory value?"),
  p("stock-po", "Stock", "Which purchase orders are still open?"),
  p("equip-eol", "Equipment", "Which equipment is closest to end of life?"),
  p("equip-repairs", "Equipment", "Which equipment has had the most repairs?"),
  p("equip-down", "Equipment", "What equipment is broken down right now?"),
  p("maint-week", "Maintenance", "What maintenance was done this week?"),
  p("maint-parts", "Maintenance", "What did we spend on repair parts this month?"),
  p("maint-open", "Maintenance", "Which maintenance jobs are still open?"),
  p("prod-month", "Production", "How many tonnes did we produce this month?"),
  p("prod-last", "Production", "How does production this month compare with last month?"),
  p("prod-yesterday", "Production", "What was yesterday's production?"),
  p("cost-per-ton", "Costs", "What is our rand per ton this month and why?"),
  p("cost-total", "Costs", "What were our total expenses this month?"),
  p("cost-biggest", "Costs", "What is our biggest cost this month?"),
  p("cost-fuel", "Costs", "How much did we spend on fuel this month?"),
  p("down-month", "Downtime", "How much downtime did we have this month?"),
  p("down-causes", "Downtime", "What were the main causes of downtime this month?"),
  p("down-week", "Downtime", "How many hours of downtime did we have this week?"),
  p("people-total", "People", "What is our total headcount?"),
  p("people-today", "People", "How many employees are on site today?"),
  p("report-month", "Reports", "Draft this month's performance report for the owner"),
  p("report-week", "Reports", "Summarise this week for the managers in five bullet points"),
];

/** Shown first until you have used enough quick chats to fill the list yourself. */
const DEFAULT_IDS = ["stock-reorder", "equip-eol", "report-month", "cost-per-ton"];

export const MAX_QUICK_TEXT = 300;

/* ---------- Small localStorage-backed store (kept in this browser) ---------- */

function createStore<T>(key: string, fallback: T, isValid: (v: unknown) => v is T) {
  let cache: T | null = null;
  const listeners = new Set<() => void>();

  const read = (): T => {
    if (cache !== null) return cache;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "null");
      cache = isValid(parsed) ? parsed : fallback;
    } catch {
      cache = fallback;
    }
    return cache;
  };
  const write = (next: T) => {
    cache = next;
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* storage unavailable: changes last for this tab only */
    }
    listeners.forEach((l) => l());
  };
  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) {
        cache = null;
        cb();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", onStorage);
    };
  };
  return { read, write, subscribe, fallback };
}

const isCategory = (c: unknown): c is Category => CATEGORIES.includes(c as Category);
const isCustomList = (v: unknown): v is QuickChat[] =>
  Array.isArray(v) &&
  v.every(
    (x) => x && typeof x.id === "string" && typeof x.text === "string" && isCategory(x.category),
  );
const isIdList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

const EMPTY_CUSTOM: QuickChat[] = [];
const EMPTY_IDS: string[] = [];
const customStore = createStore<QuickChat[]>("reefie:quick:custom:v1", EMPTY_CUSTOM, isCustomList);
const recentStore = createStore<string[]>("reefie:quick:recent:v1", EMPTY_IDS, isIdList);

/** The three cards on the empty chat screen: most recently used, topped up with the defaults. */
export function pickTopThree(all: QuickChat[], recentIds: string[]): QuickChat[] {
  const byId = new Map(all.map((q) => [q.id, q]));
  const ids: string[] = [];
  for (const id of [...recentIds, ...DEFAULT_IDS]) {
    if (byId.has(id) && !ids.includes(id)) ids.push(id);
    if (ids.length === 3) break;
  }
  return ids.map((id) => byId.get(id)!);
}

export function groupByCategory(items: QuickChat[], query: string) {
  const q = query.trim().toLowerCase();
  const match = (x: QuickChat) =>
    !q || x.text.toLowerCase().includes(q) || x.category.toLowerCase().includes(q);
  return CATEGORIES.map((category) => ({
    category,
    items: items.filter((x) => x.category === category && match(x)),
  })).filter((g) => g.items.length > 0);
}

const newId = () => `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function useQuickChats() {
  const custom = useSyncExternalStore(customStore.subscribe, customStore.read, () => EMPTY_CUSTOM);
  const recent = useSyncExternalStore(recentStore.subscribe, recentStore.read, () => EMPTY_IDS);

  const all = useMemo(() => [...PRESETS, ...custom.map((c) => ({ ...c, custom: true }))], [custom]);
  const topThree = useMemo(() => pickTopThree(all, recent), [all, recent]);

  const markUsed = useCallback((id: string) => {
    recentStore.write([id, ...recentStore.read().filter((x) => x !== id)].slice(0, 12));
  }, []);

  const add = useCallback((category: Category, text: string) => {
    const item: QuickChat = { id: newId(), category, text: text.trim().slice(0, MAX_QUICK_TEXT) };
    customStore.write([...customStore.read(), item]);
    return item;
  }, []);

  const update = useCallback((id: string, category: Category, text: string) => {
    customStore.write(
      customStore
        .read()
        .map((c) =>
          c.id === id ? { ...c, category, text: text.trim().slice(0, MAX_QUICK_TEXT) } : c,
        ),
    );
  }, []);

  const remove = useCallback((id: string) => {
    const list = customStore.read();
    const index = list.findIndex((c) => c.id === id);
    if (index < 0) return;
    const removed = list[index];
    customStore.write(list.filter((c) => c.id !== id));
    recentStore.write(recentStore.read().filter((x) => x !== id));
    toast("Quick chat deleted", {
      action: {
        label: "Undo",
        onClick: () => {
          const cur = customStore.read();
          const next = [...cur];
          next.splice(Math.min(index, next.length), 0, removed);
          customStore.write(next);
        },
      },
    });
  }, []);

  return { all, topThree, markUsed, add, update, remove };
}
