import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";

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

export const Route = createFileRoute("/worker/sessions")({
  component: WorkerSessionsPage,
});

function WorkerSessionsPage() {
  const sessions = useQuery({
    queryKey: ["sessions", "mine"],
    queryFn: () => apiRequest<UserSession[]>("/api/v1/sessions"),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Active Sign-ins</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Devices currently signed in to your REEF account.
        </p>
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
            className="rounded-lg border p-4 space-y-3"
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
