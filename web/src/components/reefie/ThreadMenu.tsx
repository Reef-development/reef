import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Download, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deleteThreadWithUndo,
  exportThread,
  threadTitle,
  usePinned,
  type Thread,
} from "@/lib/reefie/threads";
import { cn } from "@/lib/utils";

/** The ⋯ menu for one saved chat: rename, pin, export, delete. Used by the list and the chat header. */
export function ThreadMenu({
  thread,
  activeId,
  onRename,
  triggerClassName,
}: {
  thread: Thread;
  activeId?: string;
  onRename: () => void;
  triggerClassName?: string;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { pinned, toggle } = usePinned();
  const isPinned = pinned.includes(thread.id);
  const skipRefocus = useRef(false);
  const title = threadTitle(thread);

  const onDelete = () => {
    deleteThreadWithUndo(qc, thread.id, () => {
      if (activeId === thread.id)
        navigate({ to: "/reefie/$threadId", params: { threadId: thread.id } });
    });
    if (activeId === thread.id) navigate({ to: "/reefie", replace: true });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Options for ${title}`}
          className={cn(
            "size-9 shrink-0 text-muted-foreground hover:text-foreground",
            triggerClassName,
          )}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56"
        // Without this the menu hands focus back to its button and cancels the rename field.
        onCloseAutoFocus={(e) => {
          if (skipRefocus.current) {
            e.preventDefault();
            skipRefocus.current = false;
          }
        }}
      >
        <DropdownMenuItem
          className="min-h-10 gap-2 text-sm"
          onSelect={() => {
            skipRefocus.current = true;
            onRename();
          }}
        >
          <Pencil className="size-4" /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-10 gap-2 text-sm" onSelect={() => toggle(thread.id)}>
          {isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          {isPinned ? "Unpin" : "Pin to top"}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-10 gap-2 text-sm"
          onSelect={() => void exportThread(thread.id, title)}
        >
          <Download className="size-4" /> Export as Markdown
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="min-h-10 gap-2 text-sm text-destructive focus:text-destructive"
          onSelect={onDelete}
        >
          <Trash2 className="size-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
