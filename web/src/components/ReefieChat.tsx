import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  LayoutGrid,
  Loader2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { QuickChatPicker } from "@/components/reefie/QuickChatPicker";
import { CATEGORY_ICONS } from "@/components/reefie/category-icons";
import { useQuickChats, type QuickChat } from "@/lib/reefie/quick-chats";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useIsMobile } from "@/hooks/use-mobile";
import reefieAvatar from "@/assets/reefie-avatar.png";
import { cn } from "@/lib/utils";

const TOOL_LABELS: Record<string, string> = {
  inventory_status: "Stock levels",
  maintenance_status: "Maintenance",
  downtime_by_mine: "Downtime by mine",
  production_and_costs: "Production and costs",
  headcount: "Headcount",
};

type ToolPartLike = {
  type: string;
  state: never;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

type Segment = { kind: "text"; text: string } | { kind: "tools"; tools: ToolPartLike[] };

/** Keeps the order of the message but merges back-to-back tool calls into one group. */
function toSegments(message: UIMessage): Segment[] {
  const out: Segment[] = [];
  for (const part of message.parts) {
    if (part.type === "text") {
      if (part.text) out.push({ kind: "text", text: part.text });
    } else if (part.type.startsWith("tool-")) {
      const tool = part as unknown as ToolPartLike;
      const last = out[out.length - 1];
      if (last?.kind === "tools") last.tools.push(tool);
      else out.push({ kind: "tools", tools: [tool] });
    }
  }
  return out;
}

const toolName = (type: string) => type.replace(/^tool-/, "");
const toolLabel = (type: string) =>
  TOOL_LABELS[toolName(type)] ?? toolName(type).replace(/_/g, " ");

export function ReefieChat({
  threadId,
  initialMessages,
}: {
  threadId: string;
  initialMessages: UIMessage[];
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isMobile = useIsMobile();

  const { messages, sendMessage, status, stop, error } = useChat({
    id: threadId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: async ({ messages: msgs }) => {
        const { data } = await supabase.auth.getSession();
        return {
          headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
          body: { messages: msgs, threadId },
        };
      },
    }),
    onError: (e) => toast.error(e.message || "Reefie could not respond"),
  });

  const busy = status === "submitted" || status === "streaming";
  const draftKey = `reefie:draft:${threadId}`;
  const initialDraft =
    typeof window === "undefined" ? "" : (window.sessionStorage.getItem(draftKey) ?? "");

  // Focus the box on desktop only. On a phone it would pop the keyboard over the answer.
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) textareaRef.current?.focus();
  }, [threadId, status]);

  const quick = useQuickChats();
  const [pickerOpen, setPickerOpen] = useState(false);

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    void sendMessage({ text: text.trim() });
  };

  const sendQuick = (item: QuickChat) => {
    if (busy) return;
    quick.markUsed(item.id);
    send(item.text);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl gap-7 px-4 py-6 sm:px-6">
          {messages.length === 0 ? (
            <EmptyState
              items={quick.topThree}
              onPick={sendQuick}
              onMore={() => setPickerOpen(true)}
            />
          ) : (
            messages.map((m, idx) => (
              <ChatMessage
                key={m.id}
                message={m}
                streaming={status === "streaming" && idx === messages.length - 1}
              />
            ))
          )}

          {status === "submitted" && (
            <div className="flex items-center gap-3">
              <Avatar />
              <Shimmer className="text-base">Reefie is checking the site data…</Shimmer>
            </div>
          )}

          {status === "error" && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-[15px] text-foreground"
            >
              <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
              <div>
                <p className="font-medium">Reefie couldn’t answer that.</p>
                <p className="text-muted-foreground">
                  {error?.message ? `${error.message} ` : ""}Send your message again to retry.
                </p>
              </div>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="shrink-0 bg-gradient-to-t from-background from-70% to-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <PromptInput
            className="[&>[data-slot=input-group]]:rounded-2xl [&>[data-slot=input-group]]:border-border [&>[data-slot=input-group]]:bg-card [&>[data-slot=input-group]]:shadow-md"
            onSubmit={async (msg, e) => {
              e.preventDefault();
              const text = msg.text ?? "";
              if (!text.trim() || busy) return;
              window.sessionStorage.removeItem(draftKey);

              try {
                await sendMessage({ text: text.trim() });
              } catch (error) {
                window.sessionStorage.setItem(draftKey, text);
                throw error;
              }
            }}
          >
            <PromptInputTextarea
              key={threadId}
              defaultValue={initialDraft}
              ref={textareaRef}
              aria-label="Message Reefie"
              placeholder={isMobile ? "Ask Reefie…" : "Ask about stock, repairs, tonnes or costs…"}
              onChange={(e) => {
                const value = e.currentTarget.value;
                if (value) {
                  window.sessionStorage.setItem(draftKey, value);
                } else {
                  window.sessionStorage.removeItem(draftKey);
                }
              }}
              className="min-h-14 py-4 pl-14 pr-16 text-base md:text-base"
            />
            {/* The send button floats at the right edge so the box stays one line tall. */}
            <PromptInputFooter className="absolute bottom-2 left-2 w-auto p-0">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                aria-label="Quick chats"
                title="Quick chats"
                className="flex size-10 items-center justify-center rounded-full text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Zap className="size-5" />
              </button>
            </PromptInputFooter>
            <PromptInputFooter className="absolute bottom-2 right-2 w-auto p-0">
              <PromptInputSubmit status={status} onStop={stop} className="size-10 rounded-full" />
            </PromptInputFooter>
          </PromptInput>
          <p className="mt-2 hidden text-center text-xs text-muted-foreground sm:block">
            Enter to send · Shift+Enter for a new line
          </p>
        </div>
      </div>
      <QuickChatPicker open={pickerOpen} onOpenChange={setPickerOpen} onPick={sendQuick} />
    </div>
  );
}

function Avatar() {
  return (
    <img
      src={reefieAvatar}
      alt=""
      width={512}
      height={512}
      className="mt-0.5 size-8 shrink-0 rounded-full bg-card ring-1 ring-border"
    />
  );
}

function EmptyState({
  items,
  onPick,
  onMore,
}: {
  items: QuickChat[];
  onPick: (item: QuickChat) => void;
  onMore: () => void;
}) {
  const card =
    "animate-fade-up group flex min-h-[4.5rem] items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-left shadow-xs outline-none transition hover:-translate-y-0.5 hover:border-accent hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring";
  const chip =
    "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/20 text-foreground";
  const label = "block text-xs font-semibold uppercase tracking-wider text-muted-foreground";

  return (
    <div className="flex min-h-[50vh] animate-fade-up flex-col items-center justify-center py-2 text-center sm:py-6">
      <img
        src={reefieAvatar}
        alt="Reefie"
        width={512}
        height={512}
        className="size-14 rounded-full bg-card ring-2 ring-accent/60 dark:ring-border sm:size-20"
      />
      <p className="mt-4 text-xl font-semibold leading-tight text-foreground sm:mt-5 sm:text-3xl">
        How can I help on site today?
      </p>
      <p className="mt-2 max-w-md text-[15px] leading-relaxed text-muted-foreground sm:text-base">
        Ask about stock, maintenance, production, downtime or cost per ton. I answer from live REEF
        data.
      </p>

      <div className="mt-6 grid w-full max-w-2xl gap-2.5 sm:mt-8 sm:grid-cols-2">
        {items.map((item, i) => {
          const Icon = CATEGORY_ICONS[item.category];
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onPick(item)}
              style={{ animationDelay: `${i * 60}ms` }}
              className={card}
            >
              <span className={chip}>
                <Icon className="size-5" />
              </span>
              <span className="min-w-0">
                <span className={label}>{item.category}</span>
                <span className="line-clamp-3 block text-[15px] leading-snug text-foreground">
                  {item.text}
                </span>
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onMore}
          style={{ animationDelay: `${items.length * 60}ms` }}
          className={card}
        >
          <span className={chip}>
            <LayoutGrid className="size-5" />
          </span>
          <span className="min-w-0">
            <span className={label}>More</span>
            <span className="block text-[15px] leading-snug text-foreground">
              Browse every quick chat, or add your own
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

function ChatMessage({ message, streaming }: { message: UIMessage; streaming: boolean }) {
  const segments = toSegments(message);
  if (segments.length === 0) return null;

  if (message.role === "user") {
    const text = segments.map((s) => (s.kind === "text" ? s.text : "")).join("\n");
    return (
      <Message from="user" className="max-w-[88%] sm:max-w-[80%]">
        <MessageContent className="group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-md group-[.is-user]:bg-primary group-[.is-user]:px-4 group-[.is-user]:py-2.5 group-[.is-user]:text-primary-foreground">
          <p className="whitespace-pre-wrap break-words text-base leading-relaxed">{text}</p>
        </MessageContent>
      </Message>
    );
  }

  const fullText = segments
    .map((s) => (s.kind === "text" ? s.text : ""))
    .join("\n\n")
    .trim();

  return (
    <div className="flex gap-3">
      <Avatar />
      <Message from="assistant" className="min-w-0 max-w-full flex-1 gap-1.5">
        <MessageContent className="gap-3 text-base">
          {segments.map((s, i) =>
            s.kind === "text" ? (
              <MessageResponse key={i} className="reefie-prose text-base leading-7">
                {s.text}
              </MessageResponse>
            ) : (
              <ToolSteps key={i} tools={s.tools} />
            ),
          )}
        </MessageContent>
        {fullText && !streaming && <CopyButton text={fullText} />}
      </Message>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          toast.error("Couldn't copy to the clipboard");
        }
      }}
      className="-ml-2 flex h-9 w-fit items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
    >
      {copied ? <Check className="size-4 text-green-600" /> : <Copy className="size-4" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** One quiet line per group of data lookups. The raw inputs and results sit behind it. */
function ToolSteps({ tools }: { tools: ToolPartLike[] }) {
  const running = tools.some(
    (t) => t.state !== ("output-available" as never) && t.state !== ("output-error" as never),
  );
  const failed = tools.filter((t) => t.state === ("output-error" as never));
  const names = [...new Set(tools.map((t) => toolLabel(t.type)))];

  return (
    <Collapsible className="group/steps w-full">
      <CollapsibleTrigger className="flex min-h-9 w-full items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-left text-sm text-muted-foreground outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
        {running ? (
          <Loader2 className="size-4 shrink-0 animate-spin" />
        ) : failed.length > 0 ? (
          <AlertCircle className="size-4 shrink-0 text-destructive" />
        ) : (
          <CheckCircle2 className="size-4 shrink-0 text-green-600" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {running ? "Checking " : failed.length > 0 ? "Couldn’t read " : "Checked "}
          <span className="font-medium text-foreground">{names.join(", ")}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 transition-transform group-data-[state=open]/steps:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">
        {tools.map((p, i) => (
          <Tool defaultOpen={false} key={i} className={cn("mb-0 bg-card")}>
            <ToolHeader type={p.type as never} state={p.state} title={toolLabel(p.type)} />
            <ToolContent>
              <ToolInput input={p.input} />
              <ToolOutput errorText={p.errorText} output={p.output as never} />
            </ToolContent>
          </Tool>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
