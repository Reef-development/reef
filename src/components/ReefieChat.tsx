import { useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { supabase } from "@/integrations/supabase/client";
import {
  Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput, PromptInputTextarea, PromptInputFooter, PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import reefieAvatar from "@/assets/reefie-avatar.png";
import { toast } from "sonner";

const SUGGESTIONS = [
  "What stock is below reorder point right now?",
  "Which equipment is closest to end of life?",
  "Draft this month's performance report for the owner",
  "What is our rand per ton this month and why?",
];

export function ReefieChat({ threadId, initialMessages }: { threadId: string; initialMessages: UIMessage[] }) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const { messages, sendMessage, status, stop } = useChat({
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

  useEffect(() => {
    textareaRef.current?.focus();
  }, [threadId, status]);

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    void sendMessage({ text: text.trim() });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)] min-h-[420px]">
      <Conversation className="flex-1">
        <ConversationContent className="max-w-3xl mx-auto w-full">
          {messages.length === 0 ? (
            <div className="py-10 animate-fade-up">
              <ConversationEmptyState
                icon={<img src={reefieAvatar} alt="Reefie" width={512} height={512} className="w-14 h-14" />}
                title="Reefie"
                description="Your R.E.E.F operations assistant — stock, maintenance, production and cost answers from live site data."
              />
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    style={{ animationDelay: `${i * 50}ms` }}
                    className="animate-fade-up text-left text-sm rounded-lg border border-border/70 bg-card/60 px-4 py-3 transition-all hover:border-primary/50 hover:bg-card hover:-translate-y-0.5"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <Message from={m.role} key={m.id}>
                <MessageContent>
                  {m.parts.map((part, i) => {
                    if (part.type === "text") {
                      return <MessageResponse key={i}>{part.text}</MessageResponse>;
                    }
                    if (part.type.startsWith("tool-")) {
                      const p = part as unknown as {
                        type: string; state: never; input?: unknown; output?: unknown; errorText?: string;
                      };
                      return (
                        <Tool defaultOpen={false} key={i}>
                          <ToolHeader type={p.type as never} state={p.state} />
                          <ToolContent>
                            <ToolInput input={p.input} />
                            <ToolOutput errorText={p.errorText} output={p.output as never} />
                          </ToolContent>
                        </Tool>
                      );
                    }
                    return null;
                  })}
                </MessageContent>
              </Message>
            ))
          )}
          {status === "submitted" && (
            <Shimmer className="text-sm">Reefie is checking the site data…</Shimmer>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="max-w-3xl mx-auto w-full pt-3">
        <PromptInput
          onSubmit={(msg, e) => {
            e.preventDefault();
            const text = msg.text ?? "";
            if (!text.trim() || busy) return;
            void sendMessage({ text: text.trim() });
            (e.currentTarget as HTMLFormElement).reset();
          }}
        >
          <PromptInputTextarea ref={textareaRef} placeholder="Ask Reefie about stock, repairs, tonnes or costs…" />
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit status={status} onStop={stop} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}