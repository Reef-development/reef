import type { DueReason, ServiceDue } from "@reef/shared";

/**
 * Is a machine due a service? (FR-12, the maintenance reminder.)
 *
 * This is arithmetic over a date and a tonnage and nothing else, so it is tested without a
 * database and gives the same answer whenever it is run. `today` is passed in rather than read
 * from the clock, because a rule that changes its answer at midnight cannot be reconstructed
 * afterwards and a test written against today stops testing anything tomorrow.
 */

export type Machine = {
  id: string;
  name: string;
  mine_id: string | null;
  status: string;
  install_date: string | null;
  tons_since_install: number;
  service_interval_days: number | null;
  service_interval_tons: number | null;
  /** From the most recent maintenance log, when there is one. */
  next_due_date: string | null;
  next_due_tons: number | null;
  last_serviced_on: string | null;
};

/** A date a whole number of days later, as YYYY-MM-DD. */
function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * What the machine is measured against.
 *
 * The last service wins where there is one, because an engineer who wrote "next due" on the job
 * card knew something the interval did not. Only when a machine has never been serviced does it
 * fall back to its interval counted from the day it was installed.
 */
function thresholds(m: Machine): { dueDate: string | null; dueTons: number | null } {
  const dueDate =
    m.next_due_date ??
    (m.last_serviced_on && m.service_interval_days
      ? addDays(m.last_serviced_on, m.service_interval_days)
      : m.install_date && m.service_interval_days
        ? addDays(m.install_date, m.service_interval_days)
        : null);

  const dueTons = m.next_due_tons ?? m.service_interval_tons;

  return { dueDate, dueTons };
}

/**
 * The reminder for one machine, or null when none is owed.
 *
 * A machine with no interval set and no next due recorded is never due. That is deliberate: a
 * reminder nobody asked for, raised against a figure nobody entered, teaches people to ignore
 * reminders, and an ignored reminder is worse than none.
 */
export function serviceDue(m: Machine, today: string): ServiceDue | null {
  if (m.status !== "active") return null;

  const { dueDate, dueTons } = thresholds(m);

  let reason: DueReason | null = null;
  let marker = "";

  // The date is checked first, so a machine that is late on both reads as late rather than busy.
  if (dueDate && today >= dueDate) {
    reason = "date";
    marker = dueDate;
  } else if (dueTons !== null && dueTons > 0 && m.tons_since_install >= dueTons) {
    reason = "tons";
    marker = dueTons.toFixed(2);
  }

  if (!reason) return null;

  return {
    equipment_id: m.id,
    equipment_name: m.name,
    mine_id: m.mine_id,
    reason,
    marker,
    // The marker is part of the key, so the same machine falling due again after it has been
    // serviced raises a new reminder, while the same machine still being due tomorrow does not.
    dedupe_key: `service_due:${m.id}:${reason}:${marker}`,
  };
}

/** Everything due, soonest machine name first so the list reads the same way twice. */
export function allDue(machines: readonly Machine[], today: string): ServiceDue[] {
  return machines
    .map((m) => serviceDue(m, today))
    .filter((d): d is ServiceDue => d !== null)
    .sort((a, b) => a.equipment_name.localeCompare(b.equipment_name));
}

/** The message a person reads. Plain, because it arrives in an inbox and on a plant phone. */
export function message(due: ServiceDue): { subject: string; body: string } {
  const subject = `Service due: ${due.equipment_name}`;
  const body =
    due.reason === "date"
      ? `${due.equipment_name} was due a service on ${due.marker}. Book it in, or record the service if it has already been done.`
      : `${due.equipment_name} has passed ${due.marker} tons since its last service. Book it in, or record the service if it has already been done.`;
  return { subject, body };
}
