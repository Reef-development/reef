import { createFileRoute, redirect } from "@tanstack/react-router";
import { fetchMe } from "@/lib/api";
import { Spinner } from "@/components/ui/spinner";

export const Route = createFileRoute("/")({
  ssr: false,
  // Show something straight away. The API can take a while to answer after it has been idle,
  // and without this the screen stays blank, which looks like a crash in the mobile app.
  pendingMs: 0,
  pendingComponent: () => (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
      <Spinner className="size-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Loading REEF…</p>
    </div>
  ),
  beforeLoad: async () => {
    const me = await fetchMe();
    if (!me) throw redirect({ to: "/auth" });
    if (me.role === "owner" || me.role === "manager") {
      throw redirect({ to: "/dashboard" });
    }
    throw redirect({ to: "/worker" });
  },
  component: () => null,
});
