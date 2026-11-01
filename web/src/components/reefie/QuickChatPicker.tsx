import { useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CATEGORY_ICONS } from "./category-icons";
import {
  CATEGORIES,
  groupByCategory,
  MAX_QUICK_TEXT,
  type Category,
  type QuickChat,
  useQuickChats,
} from "@/lib/reefie/quick-chats";

type FormState = { id?: string; category: Category; text: string };

/** Browse every quick chat, search them, and add, edit or delete your own. */
export function QuickChatPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (item: QuickChat) => void;
}) {
  const { all, add, update, remove } = useQuickChats();
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<FormState | null>(null);

  const groups = useMemo(() => groupByCategory(all, query), [all, query]);

  const close = (next: boolean) => {
    if (!next) {
      setQuery("");
      setForm(null);
    }
    onOpenChange(next);
  };

  const save = () => {
    if (!form) return;
    const text = form.text.trim();
    if (text.length < 3) return;
    if (form.id) update(form.id, form.category, text);
    else add(form.category, text);
    setForm(null);
    setQuery("");
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[88dvh] w-[calc(100vw-1.5rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-1 px-5 pb-3 pt-5 pr-12 text-left">
          <DialogTitle className="text-xl normal-case">Quick chats</DialogTitle>
          <DialogDescription className="text-[15px]">
            Tap one to send it. Add your own for the questions you ask often.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 px-5 pb-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search quick chats"
              aria-label="Search quick chats"
              className="h-11 pl-9 text-base md:text-base"
            />
          </div>
          <Button
            type="button"
            className="h-11 shrink-0 gap-1.5"
            onClick={() => setForm({ category: "Costs", text: "" })}
          >
            <Plus className="size-4" /> <span className="hidden sm:inline">New</span>
            <span className="sr-only sm:hidden">New quick chat</span>
          </Button>
        </div>

        {form && (
          <div className="mx-5 mb-3 space-y-3 rounded-xl border border-border bg-muted/40 p-4">
            <p className="text-sm font-semibold">
              {form.id ? "Edit quick chat" : "New quick chat"}
            </p>
            <textarea
              autoFocus
              value={form.text}
              maxLength={MAX_QUICK_TEXT}
              rows={2}
              aria-label="Question to ask Reefie"
              placeholder="e.g. How much did we spend on tyres this month?"
              onChange={(e) => setForm({ ...form, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  save();
                }
              }}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={form.category}
                aria-label="Category"
                onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
                className="h-10 rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <div className="ml-auto flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10"
                  onClick={() => setForm(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="h-10"
                  disabled={form.text.trim().length < 3}
                  onClick={save}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t px-3 pb-4 pt-1">
          {groups.length === 0 && (
            <div className="px-3 py-10 text-center text-[15px] text-muted-foreground">
              <p>No quick chats match “{query}”.</p>
              {query.trim().length >= 3 && (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4 h-10"
                  onClick={() => setForm({ category: "Costs", text: query.trim() })}
                >
                  Save it as a quick chat
                </Button>
              )}
            </div>
          )}

          {groups.map(({ category, items }) => {
            const Icon = CATEGORY_ICONS[category];
            return (
              <section key={category} className="mt-3">
                <h3 className="flex items-center gap-2 px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Icon className="size-3.5" /> {category}
                </h3>
                <ul>
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="group flex items-center rounded-lg hover:bg-muted/70"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          close(false);
                          onPick(item);
                        }}
                        className="min-h-11 min-w-0 flex-1 rounded-lg px-2 py-2 text-left text-[15px] leading-snug outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {item.text}
                        {item.custom && (
                          <span className="ml-2 rounded-full bg-accent/25 px-2 py-0.5 align-middle text-[11px] font-medium text-foreground">
                            Mine
                          </span>
                        )}
                      </button>
                      {item.custom && (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-10 shrink-0 text-muted-foreground"
                            aria-label={`Edit: ${item.text}`}
                            onClick={() =>
                              setForm({ id: item.id, category: item.category, text: item.text })
                            }
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-10 shrink-0 text-muted-foreground hover:text-destructive"
                            aria-label={`Delete: ${item.text}`}
                            onClick={() => remove(item.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
