import { isFailure, type ApiResponse, type ListMeta, type Role } from "@reef/shared";
import { supabase } from "@/integrations/supabase/client";

const BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:8787").replace(/\/$/, "");

/** A refused or failed API call, carrying the server's error code so screens can react to it. */
export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * Calls the REEF API as the signed-in user. Sign-in itself still happens through Supabase Auth;
 * this attaches that session's access token, and the API decides what the user may do.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<{ data: T; meta?: ListMeta }> {
  const { data: auth } = await supabase.auth.getSession();
  const token = auth.session?.access_token;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiRequestError("NETWORK", "Cannot reach the REEF server. Check your connection and try again", 0);
  }

  const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!body) throw new ApiRequestError("INTERNAL", "The server sent an unreadable response", res.status);
  if (isFailure(body)) {
    throw new ApiRequestError(body.error.code, body.error.message, res.status, body.error.details);
  }
  return body;
}

/** Reads every page of a list endpoint. Lists are paged at 200 rows at most per request. */
export async function apiListAll<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const qs = new URLSearchParams({ ...params, page: String(page), pageSize: "200" });
    const res = await api<T[]>(`${path}?${qs}`);
    rows.push(...res.data);
    if (!res.meta || rows.length >= res.meta.total || res.data.length === 0) return rows;
  }
}

export type Me = { id: string; role: Role | null };

const ME_TTL_MS = 30_000;
let meCache: { token: string; at: number; value: Promise<Me | null> } | null = null;

/**
 * The signed-in user as the API sees them, or null when nobody is signed in. Every route guard
 * asks this, including when the router preloads a page on hover, so the answer is reused for
 * 30 seconds per session. A different sign-in has a different token and is never served a
 * cached answer.
 */
export async function fetchMe(): Promise<Me | null> {
  const { data: auth } = await supabase.auth.getSession();
  const token = auth.session?.access_token;
  if (!token) return null;
  if (meCache && meCache.token === token && Date.now() - meCache.at < ME_TTL_MS) return meCache.value;

  const value = api<Me>("/api/v1/me").then(
    (res) => res.data,
    (e) => {
      meCache = null;
      if (e instanceof ApiRequestError && e.code === "UNAUTHENTICATED") return null;
      throw e;
    },
  );
  meCache = { token, at: Date.now(), value };
  return value;
}
