import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ERROR_STATUS, type ListMeta } from "@reef/shared";
import { ApiError } from "./errors.js";

export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200, meta?: ListMeta) {
  return c.json(meta ? { data, meta } : { data }, status);
}

export function fail(c: Context, err: ApiError) {
  const body = { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } };
  return c.json(body, ERROR_STATUS[err.code] as ContentfulStatusCode);
}
