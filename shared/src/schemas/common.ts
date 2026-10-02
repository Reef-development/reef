import { z } from "zod";

export const Id = z.uuid();

/** Query string for every list endpoint: paging and a single sort column. */
export const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z
    .string()
    .regex(/^[a-z_]+$/)
    .optional(),
  order: z.enum(["asc", "desc"]).default("asc"),
});
export type ListQuery = z.infer<typeof ListQuery>;

/** The version a client read. Sent with every update so a stale copy cannot overwrite a newer one. */
export const Version = z.number().int().positive();

/**
 * Why a change was made. Required on every update, so the history table has something to
 * record. The client sends it in the PATCH body alongside the version.
 */
export const Reason = z
  .string()
  .trim()
  .min(1, "A reason is required when changing a record")
  .max(500, "The reason is too long (500 characters maximum)");

/**
 * Turns a patch schema into an update schema. Two fields are added: the version the client
 * read, which makes two overlapping saves safe, and the reason, which records why the change
 * was made in the history table.
 */
export function versioned<T extends z.ZodObject>(patch: T) {
  return patch.extend({ version: Version, reason: Reason }).strict();
}
