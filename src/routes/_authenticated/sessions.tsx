import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";

type UserSession = {
  id: string;
  user_id: string;
  session_id: string;
  device: string | null;
  address: string | null;
  last_used_at: string;
  revoked_at: string | null;
  created_at: string;
};

type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
};

export const Route = createFileRoute("/_authenticated/sessions")({
  component: Page,
});

function Page() {
  const queryClient = useQueryClient();
  const { roles } = Route.useRouteContext();
  const isOwner = roles.includes("owner");
  const [selectedUserId, setSelectedUserId] = useState<string>("");

  const profiles = useQuery({
  queryKey: ["profiles", "session-management"],
  enabled: isOwner,
  queryFn: async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .order("full_name", { ascending: true });

    if (error) throw error;

    return (data ?? []) as Profile[];
  },
});

const selectedUserSessions = useQuery({
  queryKey: ["sessions", "user", selectedUserId],
  enabled: isOwner && selectedUserId !== "",
  queryFn: () =>
    apiRequest<UserSession[]>(
      `/api/v1/users/${selectedUserId}/sessions`,
    ),
});

  const sessions = useQuery({
    queryKey: ["sessions", "mine"],
    queryFn: () => apiRequest<UserSession[]>("/api/v1/sessions"),
  });

  const revokeSession = useMutation({
    mutationFn: (sessionId: string) =>
      apiRequest(`/api/v1/sessions/${sessionId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
  queryKey: ["sessions"],
});
      toast.success("Sign-in ended");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const revokeAllSessions = useMutation({
  mutationFn: (userId: string) =>
    apiRequest(`/api/v1/users/${userId}/sessions`, {
      method: "DELETE",
    }),
  onSuccess: () => {
    queryClient.invalidateQueries({
      queryKey: ["sessions", "user", selectedUserId],
    });
    toast.success("All sign-ins ended for this user");
  },
  onError: (error: Error) => {
    toast.error(error.message);
  },
});


 return (
  <div>
    <PageHeader
      title="Active Sign-ins"
      description="Devices currently signed in to your REEF account."
    />

    {isOwner && (
      <div className="mb-6 space-y-2">
        <label
          htmlFor="session-user"
          className="text-sm font-medium"
        >
          View another user&apos;s active sign-ins
        </label>

        <select
          id="session-user"
          value={selectedUserId}
          onChange={(event) => setSelectedUserId(event.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">Select a user</option>

          {profiles.data?.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.full_name ?? profile.email ?? profile.id}
            </option>
          ))}
        </select>
      </div>
    )}

    {isOwner && selectedUserId && (
      <div className="mb-8 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              Selected user&apos;s active sign-ins
            </h2>
            <p className="text-sm text-muted-foreground">
              Review or end active sessions for this user.
            </p>
          </div>

          <Button
            variant="destructive"
            onClick={() =>
              revokeAllSessions.mutate(selectedUserId)
            }
            disabled={
              revokeAllSessions.isPending ||
              selectedUserSessions.isLoading ||
              (selectedUserSessions.data?.length ?? 0) === 0
            }
          >
            Revoke all sign-ins
          </Button>
        </div>

        {selectedUserSessions.isLoading && (
          <p className="text-sm text-muted-foreground">
            Loading selected user&apos;s sign-ins...
          </p>
        )}

        {selectedUserSessions.isError && (
          <p className="text-sm text-destructive">
            {selectedUserSessions.error instanceof Error
              ? selectedUserSessions.error.message
              : "Could not load selected user sign-ins"}
          </p>
        )}

        <div className="space-y-3">
          {selectedUserSessions.data?.map((session) => (
            <div
              key={session.id}
              className="rounded-lg border p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
            >
              <div className="space-y-1">
                <p className="font-medium">
                  {session.device ?? "Unknown device"}
                </p>

                <p className="text-sm text-muted-foreground">
                  Address: {session.address ?? "Unknown"}
                </p>

                <p className="text-sm text-muted-foreground">
                  Last used:{" "}
                  {new Date(session.last_used_at).toLocaleString()}
                </p>
              </div>

              <Button
                variant="outline"
                onClick={() =>
                  revokeSession.mutate(session.session_id)
                }
                disabled={revokeSession.isPending}
              >
                Revoke this sign-in
              </Button>
            </div>
          ))}

          {!selectedUserSessions.isLoading &&
            !selectedUserSessions.isError &&
            selectedUserSessions.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No active sign-ins found for this user.
              </p>
            )}
        </div>
      </div>
    )}

    <div className="mb-3">
      <h2 className="text-lg font-semibold">
        My active sign-ins
      </h2>
    </div>

    {sessions.isLoading && (
      <p className="text-sm text-muted-foreground">
        Loading active sign-ins...
      </p>
    )}

    {sessions.isError && (
      <p className="text-sm text-destructive">
        {sessions.error instanceof Error
          ? sessions.error.message
          : "Could not load sign-ins"}
      </p>
    )}

    <div className="space-y-3">
      {sessions.data?.map((session) => (
        <div
          key={session.id}
          className="rounded-lg border p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
        >
          <div className="space-y-1">
            <p className="font-medium">
              {session.device ?? "Unknown device"}
            </p>

            <p className="text-sm text-muted-foreground">
              Address: {session.address ?? "Unknown"}
            </p>

            <p className="text-sm text-muted-foreground">
              Last used:{" "}
              {new Date(session.last_used_at).toLocaleString()}
            </p>
          </div>

          {isOwner && (
            <Button
              variant="outline"
              onClick={() =>
                revokeSession.mutate(session.session_id)
              }
              disabled={revokeSession.isPending}
            >
              Sign out this device
            </Button>
          )}
        </div>
      ))}

      {!sessions.isLoading &&
        !sessions.isError &&
        sessions.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No active sign-ins found.
          </p>
        )}
    </div>
  </div>
);
}
