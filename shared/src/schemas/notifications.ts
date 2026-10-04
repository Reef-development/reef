import { z } from "zod";

export const NOTIFICATION_KINDS = ["service_due"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Filters on a person's own notifications. There is no user filter: you only ever see yours. */
export const NotificationQuery = z.object({
  unread: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type NotificationQuery = z.infer<typeof NotificationQuery>;

export type Notification = {
  id: string;
  kind: NotificationKind;
  subject: string;
  body: string;
  equipment_id: string | null;
  mine_id: string | null;
  created_at: string;
  read_at: string | null;
};

/** Why a machine is due. Recorded so a reminder can be defended rather than just believed. */
export type DueReason = "date" | "tons";

export type ServiceDue = {
  equipment_id: string;
  equipment_name: string;
  mine_id: string | null;
  reason: DueReason;
  /** The date it fell due, or the tons figure it passed, as text for the message. */
  marker: string;
  /** What makes this the same reminder tomorrow as it was today. */
  dedupe_key: string;
};

/** One run of a scheduled job. */
export type JobRun = {
  job: string;
  ran_for: string;
  started_at: string;
  finished_at: string | null;
  outcome: string | null;
  detail: string | null;
};

/**
 * What the owner sees. `missed` is the point of the whole screen: a day with no run is not
 * reported anywhere else, because nothing failed.
 */
export type JobReport = {
  job: string;
  from: string;
  to: string;
  runs: JobRun[];
  missed: string[];
  last_success: string | null;
};

export const JobQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type JobQuery = z.infer<typeof JobQuery>;
