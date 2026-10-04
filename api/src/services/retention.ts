import {
  dueDates,
  type RetentionItem,
  type RetentionReport,
  type RetentionYears,
} from "@reef/shared";
import type { Leaver } from "../repositories/types.js";

/**
 * What the retention rules say about everyone who has left, measured against one date.
 *
 * This is arithmetic over dates and nothing else, so it is tested without a database and gives
 * the same answer whenever it is run. `asOf` is passed in rather than read from the clock for
 * the same reason: a report that quietly changes its answer at midnight cannot be reconstructed
 * afterwards, and a test written against today stops testing anything tomorrow.
 */
export function retentionPlan(
  leavers: readonly Leaver[],
  years: RetentionYears,
  asOf: string,
): RetentionReport {
  const items: RetentionItem[] = leavers.map((l) => {
    const due = dueDates(l.left_on, years);
    return {
      employee_id: l.id,
      employee_no: l.employee_no,
      full_name: l.full_name,
      left_on: l.left_on,
      identity_number_held: l.id_number_held,
      identity_due_on: due.identity,
      // A number that has already been removed is not due for removal. Counting it again would
      // make the list grow rather than shrink as the job does its work.
      identity_due: l.id_number_held && asOf >= due.identity,
      record_due_on: due.record,
      record_due: asOf >= due.record,
    };
  });

  // Soonest first, so the top of the list is what has to be dealt with rather than whoever
  // happens to have left first.
  items.sort((a, b) => a.identity_due_on.localeCompare(b.identity_due_on));

  return {
    as_of: asOf,
    years,
    leavers: items.length,
    identity_due_now: items.filter((i) => i.identity_due).length,
    record_due_now: items.filter((i) => i.record_due).length,
    items,
  };
}
