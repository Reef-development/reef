import { z } from "zod";

// Any well-formed id. Not `z.uuid()`: that also checks the RFC version digit, and the seeded
// records use hand-written ids such as 22222222-0000-0000-0000-000000000001 that Postgres
// accepts but a strict UUID check refuses.
export const Id = z.guid();

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

/** Query string for reading the history: newest first, optionally one table or one record. */
export const HistoryQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  table: z
    .string()
    .regex(/^[a-z_]+$/, "Use a table name such as mines")
    .optional(),
  row_id: Id.optional(),
});
export type HistoryQuery = z.infer<typeof HistoryQuery>;

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
