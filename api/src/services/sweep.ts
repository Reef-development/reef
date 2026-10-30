import type { ServiceDue } from "@reef/shared";
import type { NotificationDraft, ServiceSweepRepository } from "../repositories/types.js";
import { allDue, message } from "./service-due.js";

export type SweepResult = {
  machines: number;
  due: number;
  raised: number;
  /** Machines that are due but have nobody to tell. Silence here would hide a misconfigured site. */
  without_recipients: string[];
};

/**
 * One pass over every machine: work out what is due, and tell the people who can act on it.
 *
 * The count that matters is `raised`, not `due`. A machine due today and due again tomorrow is
 * one reminder, not two, so on a healthy system `due` stays steady while `raised` falls to zero
 * until something changes. A `raised` that equals `due` every single day means the suppression
 * is not working, which is the failure this returns a number for.
 */
export async function sweep(repo: ServiceSweepRepository, today: string): Promise<SweepResult> {
  const machines = await repo.machines();
  const due: ServiceDue[] = allDue(machines, today);

  const drafts: NotificationDraft[] = [];
  const without: string[] = [];

  for (const item of due) {
    const recipients = await repo.recipients(item.mine_id);
    if (recipients.length === 0) {
      without.push(item.equipment_name);
      continue;
    }
    const { subject, body } = message(item);
    for (const user_id of recipients) {
      drafts.push({
        user_id,
        kind: "service_due",
        subject,
        body,
        equipment_id: item.equipment_id,
        mine_id: item.mine_id,
        dedupe_key: item.dedupe_key,
      });
    }
  }

  const raised = drafts.length > 0 ? await repo.raise(drafts) : 0;

  return {
    machines: machines.length,
    due: due.length,
    raised,
    without_recipients: without,
  };
}

/** One line for the job record, so a run can be read without opening the notifications. */
export function describe(result: SweepResult): string {
  const parts = [`${result.machines} machines`, `${result.due} due`, `${result.raised} raised`];
  if (result.without_recipients.length > 0) {
    parts.push(`${result.without_recipients.length} with nobody to tell`);
  }
  return parts.join(", ");
}
