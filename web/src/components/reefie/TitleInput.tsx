import { useRef, useState } from "react";
import { MAX_TITLE } from "@/lib/reefie/threads";
import { cn } from "@/lib/utils";

/**
 * Inline rename field. Enter or clicking away saves, Escape cancels.
 * Font size stays at 16px on phones so iOS doesn't zoom the page.
 */
export function TitleInput({
  initial,
  onCommit,
  onCancel,
  className,
}: {
  initial: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [value, setValue] = useState(initial);
  const finished = useRef(false);

  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const next = value.trim().slice(0, MAX_TITLE);
    if (save && next && next !== initial) onCommit(next);
    else onCancel();
  };

  return (
    <input
      autoFocus
      value={value}
      maxLength={MAX_TITLE}
      aria-label="Conversation name"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      className={cn(
        "w-full rounded-md border border-ring bg-background px-2 py-1.5 text-base text-foreground outline-none ring-2 ring-ring/30 md:text-[15px]",
        className,
      )}
    />
  );
}
