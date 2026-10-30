import { useState } from "react";
import { createFileRoute, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquarePlus, MessagesSquare, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ThreadList } from "@/components/reefie/ThreadList";
import { ThreadMenu } from "@/components/reefie/ThreadMenu";
import { TitleInput } from "@/components/reefie/TitleInput";
import {
  createThread,
  DEFAULT_TITLE,
  renameThread,
  threadTitle,
  THREADS_KEY,
  useThreads,
} from "@/lib/reefie/threads";
import reefieAvatar from "@/assets/reefie-avatar.png";

export const Route = createFileRoute("/_authenticated/reefie")({ component: Layout });

function Layout() {
  const { data: threads = [] } = useThreads();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const params = useParams({ strict: false }) as { threadId?: string };
  const [historyOpen, setHistoryOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const active = threads.find((t) => t.id === params.threadId);

  // One tap: reuse the empty chat if there is one, otherwise make a new chat.
  const onNew = async () => {
    setHistoryOpen(false);
    const empty = threads.find((t) => threadTitle(t) === DEFAULT_TITLE);
    try {
      const id = empty ? empty.id : await createThread();
      if (!empty) await qc.invalidateQueries({ queryKey: THREADS_KEY });
      navigate({ to: "/reefie/$threadId", params: { threadId: id } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    // The shell's <main> has padding; cancel it so the chat can use the full screen.
    <div className="-m-4 flex h-[calc(100dvh-3.5rem)] overflow-hidden md:-m-6">
      <aside
        className="hidden w-80 shrink-0 flex-col border-r bg-card/60 lg:flex"
        aria-label="Chat history"
      >
        <ThreadList activeId={params.threadId} onNew={onNew} />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="flex h-14 shrink-0 items-center gap-1.5 border-b bg-card/80 px-2 backdrop-blur sm:gap-2 sm:px-4">
          <Button
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 lg:hidden"
            aria-label="Open chat history"
            onClick={() => setHistoryOpen(true)}
          >
            <MessagesSquare className="size-5" />
          </Button>

          <img
            src={reefieAvatar}
            alt=""
            width={512}
            height={512}
            className="hidden size-8 shrink-0 rounded-full sm:block"
          />

          <div className="min-w-0 flex-1">
            {renaming && active ? (
              <TitleInput
                initial={threadTitle(active)}
                onCommit={(title) => {
                  setRenaming(false);
                  void renameThread(qc, active.id, title);
                }}
                onCancel={() => setRenaming(false)}
              />
            ) : (
              <button
                type="button"
                disabled={!active}
                onClick={() => setRenaming(true)}
                className="group/title flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:hover:bg-muted/70"
                aria-label={active ? `Rename conversation: ${threadTitle(active)}` : undefined}
              >
                <span className="truncate text-base font-semibold leading-tight text-foreground">
                  {active ? threadTitle(active) : "Reefie"}
                </span>
                {active && (
                  <Pencil className="hidden size-3.5 shrink-0 text-muted-foreground sm:block sm:opacity-0 sm:group-hover/title:opacity-100" />
                )}
              </button>
            )}
            <p className="truncate px-1 text-xs leading-tight text-muted-foreground">
              Answers from live REEF site data
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="size-10 shrink-0 gap-1.5 p-0 sm:w-auto sm:px-3 lg:hidden"
            onClick={onNew}
            aria-label="New chat"
          >
            <MessageSquarePlus className="size-4" />
            <span className="hidden sm:inline">New</span>
          </Button>

          {active && (
            <ThreadMenu
              thread={active}
              activeId={active.id}
              onRename={() => setRenaming(true)}
              triggerClassName="size-10"
            />
          )}
        </header>

        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
      </section>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="left" className="flex w-[88vw] max-w-sm flex-col gap-0 p-0 lg:hidden">
          <div className="border-b px-4 py-3.5 pr-12">
            <SheetTitle className="text-lg normal-case">Your chats</SheetTitle>
            <SheetDescription className="sr-only">
              Open, rename, pin or delete a saved chat.
            </SheetDescription>
          </div>
          <div className="min-h-0 flex-1">
            <ThreadList
              activeId={params.threadId}
              onNew={onNew}
              onNavigate={() => setHistoryOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
