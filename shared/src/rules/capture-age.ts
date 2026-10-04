import { z } from "zod";

/**
 * REEF's plants are in Mpumalanga. "Today" is worked out there, not in UTC, so an entry
 * captured just after midnight belongs to the new day.
 */
export const REEF_TIME_ZONE = "Africa/Johannesburg";

/** The settings the owner may change, each with the values it accepts. */
export const SETTINGS = {
  capture_max_age_days: z
    .number()
    .int("Use a whole number of days")
    .min(1, "The limit must be at least 1 day")
    .max(365, "The limit can be at most 365 days"),
} as const;
export type SettingKey = keyof typeof SETTINGS;
export const DEFAULT_CAPTURE_MAX_AGE_DAYS = 60;

/** Today's date in REEF's time zone, as YYYY-MM-DD. */
export function reefToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REEF_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. Positive when `from` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 12 Jul 2026 — the way a date reads on the plant floor. */
export function readableDate(date: string): string {
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/**
 * Why an entry dated `date` may not be captured today, or null if it may. An entry exactly
 * `limitDays` old is still accepted; one day older is refused.
 */
export function lateCaptureProblem(
  date: string,
  limitDays: number,
  today: string = reefToday(),
): string | null {
  const age = daysBetween(date, today);
  if (age <= limitDays) return null;
  return (
    `This entry is dated ${readableDate(date)}, which is ${age} days ago. ` +
    `Entries older than ${limitDays} days can't be captured. If it still needs recording, speak to your site manager.`
  );
}
