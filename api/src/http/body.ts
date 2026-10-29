import type { Context } from "hono";
import type { ZodType, z } from "zod";
import { ApiError, validationError } from "./errors.js";

/** Reads a JSON body and validates it, so a handler only ever sees data that passed the schema. */
export async function parseBody<S extends ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError("VALIDATION_FAILED", "Request body must be valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
}

export function parseWith<S extends ZodType>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
}
