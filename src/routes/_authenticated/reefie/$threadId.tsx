import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { supabase } from "@/integrations/supabase/client";
import { ReefieChat } from "@/components/ReefieChat";

export const Route = createFileRoute("/_authenticated/reefie/$threadId")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Reefie — R.E.E.F Operations Assistant" },
      { name: "description", content: "Ask Reefie about live stock, maintenance, production and cost data across REEF mining sites." },
      { property: "og:title", content: "Reefie — R.E.E.F Operations Assistant" },
      { property: "og:description", content: "Live mining operations answers, advice and monthly report drafting." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function Page() {
  const { threadId } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["reefie_messages", threadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reefie_messages")
        .select("message")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => r.message as unknown as UIMessage);
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground p-6">Loading conversation…</p>;

  return <ReefieChat key={threadId} threadId={threadId} initialMessages={data ?? []} />;
}