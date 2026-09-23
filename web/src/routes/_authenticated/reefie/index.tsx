import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useThreads, createThread } from "./route";

export const Route = createFileRoute("/_authenticated/reefie/")({ component: Page });

function Page() {
  const { data: threads, isLoading } = useThreads();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    if (isLoading || !threads) return;
    let cancelled = false;
    const go = async () => {
      if (threads.length > 0) {
        navigate({ to: "/reefie/$threadId", params: { threadId: threads[0].id }, replace: true });
        return;
      }
      const id = await createThread();
      if (cancelled) return;
      await qc.invalidateQueries({ queryKey: ["reefie_threads"] });
      navigate({ to: "/reefie/$threadId", params: { threadId: id }, replace: true });
    };
    void go();
    return () => { cancelled = true; };
  }, [isLoading, threads, navigate, qc]);

  return <p className="text-sm text-muted-foreground p-6">Opening Reefie…</p>;
}