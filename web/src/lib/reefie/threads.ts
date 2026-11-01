import { useCallback, useSyncExternalStore } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { UIMessage } from "ai";
import { supabase } from "@/integrations/supabase/client";

export const THREADS_KEY = ["reefie_threads"] as const;
export const DEFAULT_TITLE = "New conversation";
export const MAX_TITLE = 80;
const UNDO_MS = 6000;

export type Thread = { id: string; title: string | null; updated_at: string };

/** Threads deleted in the UI whose database delete is still waiting out the undo window. */
const pendingDeletes = new Set<string>();

export function threadTitle(t: Pick<Thread, "title">) {
  return t.title?.trim() || DEFAULT_TITLE;
}

export function useThreads() {
  return useQuery({
    queryKey: THREADS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reefie_threads")
        .select("id, title, updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as Thread[]).filter((t) => !pendingDeletes.has(t.id));
    },
  });
}

export async function createThread() {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("reefie_threads")
    .insert({ title: DEFAULT_TITLE, user_id: auth.user!.id })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Rename with an optimistic update, rolling back if the database refuses. */
export async function renameThread(qc: QueryClient, id: string, rawTitle: string) {
  const title = rawTitle.trim().slice(0, MAX_TITLE);
  if (!title) return;
  const previous = qc.getQueryData<Thread[]>(THREADS_KEY);
  qc.setQueryData<Thread[]>(THREADS_KEY, (old = []) =>
    old.map((t) => (t.id === id ? { ...t, title } : t)),
  );
  const { error } = await supabase.from("reefie_threads").update({ title }).eq("id", id);
  if (error) {
    qc.setQueryData(THREADS_KEY, previous);
    toast.error(`Couldn't rename: ${error.message}`);
    return;
  }
  void qc.invalidateQueries({ queryKey: THREADS_KEY });
}

/**
 * Delete with no confirm dialog. The row disappears straight away and the real
 * delete only runs once the Undo toast has expired.
 */
export function deleteThreadWithUndo(qc: QueryClient, id: string, onUndo?: () => void) {
  pendingDeletes.add(id);
  qc.setQueryData<Thread[]>(THREADS_KEY, (old = []) => old.filter((t) => t.id !== id));

  let undone = false;
  const timer = setTimeout(async () => {
    if (undone) return;
    const { error } = await supabase.from("reefie_threads").delete().eq("id", id);
    pendingDeletes.delete(id);
    if (error) toast.error(`Couldn't delete: ${error.message}`);
    qc.removeQueries({ queryKey: ["reefie_messages", id] });
    void qc.invalidateQueries({ queryKey: THREADS_KEY });
  }, UNDO_MS);

  toast("Conversation deleted", {
    duration: UNDO_MS,
    action: {
      label: "Undo",
      onClick: () => {
        undone = true;
        clearTimeout(timer);
        pendingDeletes.delete(id);
        void qc.invalidateQueries({ queryKey: THREADS_KEY });
        onUndo?.();
      },
    },
  });
}

/** Download a conversation as a Markdown file. */
export async function exportThread(id: string, title: string) {
  const { data, error } = await supabase
    .from("reefie_messages")
    .select("message")
    .eq("thread_id", id)
    .order("created_at", { ascending: true });
  if (error) return toast.error(`Couldn't export: ${error.message}`);
  const messages = (data ?? []).map((r) => r.message as unknown as UIMessage);
  const body = messages
    .map((m) => {
      const text = m.parts
        .map((p) => (p.type === "text" ? p.text : ""))
        .join("")
        .trim();
      return text ? `**${m.role === "user" ? "You" : "Reefie"}:**\n\n${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
  const blob = new Blob([`# ${title}\n\n${body}\n`], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${
    title
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase() || "reefie-chat"
  }.md`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- Pinned threads (kept in this browser, so no database change) ---------- */

const PIN_KEY = "reefie:pinned:v1";
const EMPTY: string[] = [];
let pinnedCache: string[] | null = null;
const pinListeners = new Set<() => void>();

function readPinned(): string[] {
  if (pinnedCache) return pinnedCache;
  try {
    const parsed = JSON.parse(localStorage.getItem(PIN_KEY) ?? "[]");
    pinnedCache = Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    pinnedCache = [];
  }
  return pinnedCache;
}

function writePinned(ids: string[]) {
  pinnedCache = ids;
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable: pins last for this tab only */
  }
  pinListeners.forEach((l) => l());
}

function subscribePinned(cb: () => void) {
  pinListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === PIN_KEY) {
      pinnedCache = null;
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    pinListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function usePinned() {
  const pinned = useSyncExternalStore(subscribePinned, readPinned, () => EMPTY);
  const toggle = useCallback((id: string) => {
    const cur = readPinned();
    writePinned(cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur]);
  }, []);
  return { pinned, toggle };
}

/* ---------- Grouping and time labels ---------- */

export type ThreadGroup = { label: string; items: Thread[] };

export function groupThreads(threads: Thread[], pinned: string[], query: string): ThreadGroup[] {
  const q = query.trim().toLowerCase();
  const visible = q ? threads.filter((t) => threadTitle(t).toLowerCase().includes(q)) : threads;

  const pinnedItems = visible.filter((t) => pinned.includes(t.id));
  const rest = visible.filter((t) => !pinned.includes(t.id));

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(new Date());
  const DAY = 86_400_000;

  const buckets: ThreadGroup[] = [
    { label: "Pinned", items: pinnedItems },
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Earlier", items: [] },
  ];
  for (const t of rest) {
    const age = today - startOfDay(new Date(t.updated_at));
    const i = age <= 0 ? 1 : age <= DAY ? 2 : age <= 7 * DAY ? 3 : 4;
    buckets[i].items.push(t);
  }
  return buckets.filter((b) => b.items.length > 0);
}

export function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
