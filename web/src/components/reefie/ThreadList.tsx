import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Pin, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  groupThreads,
  relativeTime,
  renameThread,
  threadTitle,
  useThreads,
  usePinned,
  type Thread,
} from "@/lib/reefie/threads";
import { cn } from "@/lib/utils";
import { TitleInput } from "./TitleInput";
import { ThreadMenu } from "./ThreadMenu";

export function ThreadList({
  activeId,
  onNew,
  onNavigate,
}: {
  activeId?: string;
  onNew: () => void;
  /** Called after a chat is opened, so the mobile drawer can close itself. */
  onNavigate?: () => void;
}) {
  const { data: threads = [], isLoading } = useThreads();
  const { pinned } = usePinned();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const groups = useMemo(() => groupThreads(threads, pinned, query), [threads, pinned, query]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2.5 p-3">
        <Button onClick={onNew} className="h-11 w-full gap-2 text-[15px] font-medium">
          <Plus className="size-4" /> New chat
        </Button>
        {threads.length > 5 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
              className="h-10 bg-background pl-9 text-base md:text-sm"
            />
          </div>
        )}
      </div>

      <nav
        aria-label="Saved chats"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4"
      >
        {isLoading && (
          <div className="space-y-2 px-1 pt-1">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        )}

        {!isLoading && threads.length === 0 && (
          <div className="px-3 py-10 text-center text-sm text-muted-foreground">
            <MessageSquare className="mx-auto mb-2 size-6 opacity-50" />
            Your chats will show up here.
          </div>
        )}

        {!isLoading && threads.length > 0 && groups.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            No chats match “{query}”.
          </p>
        )}

        {groups.map((g) => (
          <section key={g.label} className="mb-3">
            <h3 className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {g.label}
            </h3>
            <ul className="space-y-0.5">
              {g.items.map((t) => (
                <ThreadRow
                  key={t.id}
                  thread={t}
                  active={t.id === activeId}
                  activeId={activeId}
                  pinned={pinned.includes(t.id)}
                  renaming={renamingId === t.id}
                  onStartRename={() => setRenamingId(t.id)}
                  onStopRename={() => setRenamingId(null)}
                  onSave={(title) => {
                    setRenamingId(null);
                    void renameThread(qc, t.id, title);
                  }}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          </section>
        ))}
      </nav>
    </div>
  );
}

function ThreadRow({
  thread,
  active,
  activeId,
  pinned,
  renaming,
  onStartRename,
  onStopRename,
  onSave,
  onNavigate,
}: {
  thread: Thread;
  active: boolean;
  activeId?: string;
  pinned: boolean;
  renaming: boolean;
  onStartRename: () => void;
  onStopRename: () => void;
  onSave: (title: string) => void;
  onNavigate?: () => void;
}) {
  const title = threadTitle(thread);
  return (
    <li
      className={cn(
        "group relative flex items-center rounded-lg transition-colors",
        active ? "bg-primary/10" : "hover:bg-muted/70",
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute bottom-2 left-0 top-2 w-1 rounded-full bg-accent dark:bg-primary"
        />
      )}

      {renaming ? (
        <div className="min-w-0 flex-1 px-2 py-1.5">
          <TitleInput initial={title} onCommit={onSave} onCancel={onStopRename} />
        </div>
      ) : (
        <>
          <Link
            to="/reefie/$threadId"
            params={{ threadId: thread.id }}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className="min-w-0 flex-1 rounded-lg px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex items-center gap-1.5">
              {pinned && (
                <Pin
                  aria-label="Pinned"
                  className="size-3 shrink-0 fill-accent text-accent dark:fill-primary dark:text-primary"
                />
              )}
              <span className="truncate text-[15px] font-medium leading-snug text-foreground">
                {title}
              </span>
            </span>
            <span className="block text-xs text-muted-foreground">
              {relativeTime(thread.updated_at)}
            </span>
          </Link>
          <ThreadMenu
            thread={thread}
            activeId={activeId}
            onRename={onStartRename}
            triggerClassName={cn(
              "mr-1 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100 data-[state=open]:opacity-100",
              active && "lg:opacity-100",
            )}
          />
        </>
      )}
    </li>
  );
}
