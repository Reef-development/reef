/**
 * How long employee information is kept, and which rule covers which field.
 *
 * REEF answered this in writing. An identity number is kept for five years after the person
 * leaves; everything else about an employee is kept for seven to ten years. Software cannot act
 * on "seven to ten", so seven is used, the shortest period REEF allows, because section 14 of
 * the Protection of Personal Information Act says personal information is not kept for longer
 * than is necessary. Both numbers are settings, so REEF can move either one without a change to
 * the code.
 *
 * This file is the single statement of the rule. The API reads it, the privacy document is
 * written from it, and the removal job that runs after handover will act on it.
 */

export type RetentionPeriodKey = "identity" | "record";

export type RetentionYears = Record<RetentionPeriodKey, number>;

/** What the settings fall back to when nothing is configured. */
export const DEFAULT_RETENTION: RetentionYears = { identity: 5, record: 7 };

export const RETENTION_PERIODS = {
  identity: {
    key: "identity",
    label: "Identity number",
    defaultYears: 5,
    /** What happens when the period is up. */
    action: "The identity number is cleared. The employee row itself stays.",
    source:
      "REEF, in writing: five years, under the Basic Conditions of Employment Act. Confirms the period the team had assumed.",
  },
  record: {
    key: "record",
    label: "The rest of the employee record",
    defaultYears: 7,
    action: "The employee row is archived and removed from the working tables.",
    source:
      "REEF, in writing: seven to ten years for all other employee information. Seven is used, the shortest period REEF allows, because information is not kept for longer than it is needed. Open with REEF: seven or ten.",
  },
} as const satisfies Record<RetentionPeriodKey, unknown>;

/**
 * Every column of `employees` that says something about a person, and which period covers it.
 *
 * The point of listing them one by one rather than saying "the employee record" is that the
 * removal job and the privacy document both have to name fields, and a list kept in somebody's
 * head is a list that goes out of date the first time a column is added.
 */
export const EMPLOYEE_PERSONAL_FIELDS = [
  { column: "id_number", what: "South African identity number", period: "identity" },
  { column: "full_name", what: "Name", period: "record" },
  { column: "employee_no", what: "Payroll number", period: "record" },
  { column: "phone", what: "Telephone number", period: "record" },
  { column: "position", what: "Job title", period: "record" },
  { column: "team_name", what: "Team", period: "record" },
  { column: "shift", what: "Shift worked", period: "record" },
  { column: "hourly_rate", what: "Pay rate", period: "record" },
  { column: "hire_date", what: "Date they started", period: "record" },
  { column: "notes", what: "Free text notes about the person", period: "record" },
] as const satisfies readonly {
  column: string;
  what: string;
  period: RetentionPeriodKey;
}[];

/**
 * A date a whole number of years later, as YYYY-MM-DD.
 *
 * 29 February plus five years has no 29 February to land on, and the plain arithmetic rolls it
 * forward into 1 March, which would keep a person's identity number a day longer than the rule
 * allows. It is rolled back to 28 February instead, so the anniversary is never later than the
 * rule says.
 */
export function addYears(date: string, years: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y + years, m - 1, d));
  if (target.getUTCMonth() !== m - 1) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}

/** The two dates a single leaver's record is measured against. */
export function dueDates(leftOn: string, years: RetentionYears) {
  return {
    identity: addYears(leftOn, years.identity),
    record: addYears(leftOn, years.record),
  };
}
