import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Role = "owner" | "manager" | "worker";

export function useMyRole() {
  return useQuery({
    queryKey: ["me", "role"],
    queryFn: async (): Promise<Role | null> => {
      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) return null;
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userRes.user.id);
      if (error) return null;
      const roles = (data ?? []).map((r: any) => r.role as Role);
      if (roles.includes("owner")) return "owner";
      if (roles.includes("manager")) return "manager";
      if (roles.includes("worker")) return "worker";
      return null;
    },
    staleTime: 60_000,
  });
}

export function isOwnerish(role: Role | null | undefined) {
  return role === "owner" || role === "manager";
}