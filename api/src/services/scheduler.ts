import type { JobReport, JobRun } from "@reef/shared";
import type { JobRepository, ServiceSweepRepository } from "../repositories/types.js";
import { describe, sweep } from "./sweep.js";

export const SERVICE_SWEEP = "service_due_sweep";

/**
 * The calendar day a moment belongs to, in REEF's own time zone.
 *
 * Without this, a sweep started at 01:00 in South Africa is filed against the previous day in
 * UTC, and "did yesterday's sweep run" becomes a question nobody can answer from the table.
 */
export function dayIn(zone: string, at: Date): string {
  // en-CA gives YYYY-MM-DD, which is the format the date column wants.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export type SchedulerDeps = {
  jobs: JobRepository;
  sweepRepo: ServiceSweepRepository;
  zone: string;
  now?: () => Date;
  log?: (message: string) => void;
};

/**
 * Runs the sweep for a day, if nobody else has.
 *
 * The day is claimed with an insert against a unique constraint rather than by reading the
 * table and then writing to it. Two processes starting at the same moment both read "no run
 * today" and both sweep; two processes both inserting means exactly one succeeds and the other
 * is told so by the database. Returns whether this call did the work.
 */
export async function runSweepFor(deps: SchedulerDeps, day: string): Promise<boolean> {
  const claimed = await deps.jobs.claim(SERVICE_SWEEP, day);
  if (!claimed) return false;

  try {
    const result = await sweep(deps.sweepRepo, day);
    await deps.jobs.finish(SERVICE_SWEEP, day, "ok", describe(result));
    deps.log?.(`service sweep for ${day}: ${describe(result)}`);
  } catch (err) {
    // The run is recorded as failed rather than left unfinished, because an unfinished row and
    // a crashed process look the same from the outside and only one of them is recoverable.
    const detail = err instanceof Error ? err.message : String(err);
    await deps.jobs.finish(SERVICE_SWEEP, day, "failed", detail);
    deps.log?.(`service sweep for ${day} failed: ${detail}`);
    throw err;
  }
  return true;
}

/**
 * Starts the sweep on a timer and returns the function that stops it.
 *
 * It checks often and sweeps rarely. The timer is not the schedule; the claimed day is. So a
 * restart, a redeploy, or a host that slept through the night all end with the same number of
 * sweeps, and a host that was down all day leaves a gap that `report` will show.
 */
export function startScheduler(deps: SchedulerDeps, everyMs = 15 * 60 * 1000) {
  const now = deps.now ?? (() => new Date());
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runSweepFor(deps, dayIn(deps.zone, now()));
    } catch {
      // Already recorded against the run and logged. A failure must not stop the timer, or one
      // bad day silently ends the reminders for good.
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), everyMs);
  // Without this the process will not exit while the timer is pending.
  timer.unref?.();

  return () => clearInterval(timer);
}

/** Every day between two dates, inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (
    let ms = Date.parse(`${from}T00:00:00Z`);
    ms <= Date.parse(`${to}T00:00:00Z`);
    ms += 86_400_000
  ) {
    days.push(new Date(ms).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * What ran, and more importantly what did not.
 *
 * Nothing else in the system reports a sweep that never happened, because nothing failed: there
 * is no error, no exception and no log line. The only evidence is a missing row, so the missing
 * rows are what this returns.
 */
export function report(job: string, from: string, to: string, runs: readonly JobRun[]): JobReport {
  const byDay = new Map(runs.map((r) => [r.ran_for, r]));
  const missed = daysBetween(from, to).filter((d) => !byDay.has(d));
  const successes = runs
    .filter((r) => r.outcome === "ok")
    .map((r) => r.ran_for)
    .sort();

  return {
    job,
    from,
    to,
    runs: [...runs].sort((a, b) => b.ran_for.localeCompare(a.ran_for)),
    missed,
    last_success: successes.at(-1) ?? null,
  };
}
