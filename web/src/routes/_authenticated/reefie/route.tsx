import { createFileRoute, Outlet, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Trash2, MessageSquare } from "lucide-react";
import reefieAvatar from "@/assets/reefie-avatar.png";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reefie")({ component: Layout });

type Thread = { id: string; title: string | null; updated_at: string };

export function useThreads() {
  return useQuery({
    queryKey: ["reefie_threads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reefie_threads")
        .select("id, title, updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Thread[];
    },
  });
}

export async function createThread() {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("reefie_threads")
    .insert({ title: "New conversation", user_id: auth.user!.id })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

function Layout() {
  const { data: threads = [] } = useThreads();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const params = useParams({ strict: false }) as { threadId?: string };

  const onNew = async () => {
    try {
      const id = await createThread();
      await qc.invalidateQueries({ queryKey: ["reefie_threads"] });
      navigate({ to: "/reefie/$threadId", params: { threadId: id } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onDelete = async (id: string) => {
    const { error } = await supabase.from("reefie_threads").delete().eq("id", id);
    if (error) return toast.error(error.message);
    await qc.invalidateQueries({ queryKey: ["reefie_threads"] });
    if (params.threadId === id) navigate({ to: "/reefie" });
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 animate-fade-in-soft">
      <aside className="lg:w-64 shrink-0">
        <div className="rounded-xl border border-border/70 bg-card/60 p-3">
          <div className="flex items-center gap-2 pb-3 border-b border-border/60">
            <img src={reefieAvatar} alt="Reefie" width={512} height={512} loading="lazy" className="w-8 h-8" />
            <div>
              <div className="font-display text-base leading-none tracking-wide">REEFIE</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Ops assistant</div>
            </div>
          </div>
          <Button onClick={onNew} className="w-full mt-3" size="sm">
            <Plus className="w-4 h-4 mr-1" /> New chat
          </Button>
          <ScrollArea className="mt-3 max-h-[50vh] lg:max-h-[calc(100vh-18rem)]">
            <div className="space-y-1 pr-2">
              {threads.map((t) => {
                const active = params.threadId === t.id;
                return (
                  <div
                    key={t.id}
                    className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors ${
                      active ? "bg-primary/10 text-foreground" : "hover:bg-muted/60 text-muted-foreground"
                    }`}
                  >
                    <Link
                      to="/reefie/$threadId"
                      params={{ threadId: t.id }}
                      className="flex-1 min-w-0 flex items-center gap-2 truncate"
                    >
                      <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-60" />
                      <span className="truncate">{t.title || "New conversation"}</span>
                    </Link>
                    <button
                      type="button"
                      aria-label="Delete conversation"
                      onClick={() => onDelete(t.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
              {threads.length === 0 && (
                <p className="text-xs text-muted-foreground px-2 py-3">No conversations yet.</p>
              )}
            </div>
          </ScrollArea>
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}