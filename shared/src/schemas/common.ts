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

/** The version a client read. Sent with every update so a stale copy cannot overwrite a newer one. */
export const Version = z.number().int().positive();

/** Turns a patch schema into an update schema that also requires the version the client read. */
export function versioned<T extends z.ZodObject>(patch: T) {
  return patch.extend({ version: Version }).strict();
}
