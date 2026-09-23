import { createFileRoute, redirect } from "@tanstack/react-router";
import { fetchMe } from "@/lib/api";

export const Route = createFileRoute("/")({
  ssr: false,
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
