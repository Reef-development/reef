import { useQuery } from "@tanstack/react-query";
import type { Role } from "@reef/shared";
import { fetchMe } from "@/lib/api";

export type { Role };

/**
 * The signed-in user's role as the API reports it. This only decides what the screens show;
 * the API enforces every permission itself, so hiding a button here is never the security.
 */
export function useMyRole() {
  return useQuery({
    queryKey: ["me", "role"],
    queryFn: async (): Promise<Role | null> => (await fetchMe())?.role ?? null,
    staleTime: 60_000,
  });
}

export function isOwnerish(role: Role | null | undefined) {
  return role === "owner" || role === "manager";
}
