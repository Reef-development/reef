import { supabase } from "@/integrations/supabase/client";

const API_BASE_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:8787";

type ApiEnvelope<T> = {
  data: T;
};

type ApiErrorEnvelope = {
  error?: {
    code?: string;
    message?: string;
  };
};

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("You are not signed in");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
  });

  const body = (await response.json()) as
    | ApiEnvelope<T>
    | ApiErrorEnvelope;

  if (!response.ok) {
    const message =
      "error" in body
        ? body.error?.message ?? "Request failed"
        : "Request failed";

    throw new Error(message);
  }

  return (body as ApiEnvelope<T>).data;
}