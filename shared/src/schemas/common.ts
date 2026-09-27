import { z } from "zod";

export const Id = z.uuid();

/** Query string for every list endpoint: paging and a single sort column. */
export const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.string().regex(/^[a-z_]+$/).optional(),
  order: z.enum(["asc", "desc"]).default("asc"),
});
export type ListQuery = z.infer<typeof ListQuery>;
