import { z } from "zod";
import type { RetentionYears } from "../retention.js";

/**
 * The date the answer is measured against. It is a parameter rather than "today" so the
 * question "what will be due at the end of the year" can be asked, and so the tests do not
 * change their answer as time passes.
 */
export const AsOfQuery = z.object({
  as_of: z.iso.date().optional(),
});
export type AsOfQuery = z.infer<typeof AsOfQuery>;

/** One person who has left, and where their record stands against the two periods. */
export type RetentionItem = {
  employee_id: string;
  employee_no: string | null;
  full_name: string;
  left_on: string;
  /** Whether an identity number is still stored. The number itself is never returned. */
  identity_number_held: boolean;
  identity_due_on: string;
  identity_due: boolean;
  record_due_on: string;
  record_due: boolean;
};

export type RetentionReport = {
  as_of: string;
  years: RetentionYears;
  leavers: number;
  identity_due_now: number;
  record_due_now: number;
  items: RetentionItem[];
};
