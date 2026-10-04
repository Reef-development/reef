import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@reef/shared";
import {
  SERVICE_SWEEP,
  dayIn,
  daysBetween,
  report,
  runSweepFor,
} from "../src/services/scheduler.js";
import type { Machine } from "../src/services/service-due.js";
import { MemoryJobs, MemorySweep, testApp } from "./fakes.js";

function machine(over: Partial<Machine> = {}): Machine {
  return {
    id: "m1",
    name: "Pump",
    mine_id: null,
    status: "active",
    install_date: "2026-01-01",
    tons_since_install: 0,
    service_interval_days: null,
    service_interval_tons: null,
    next_due_date: "2026-09-01",
    next_due_tons: null,
    last_serviced_on: null,
    ...over,
  };
}

function deps() {
  const jobs = new MemoryJobs();
  const sweepRepo = new MemorySweep();
  sweepRepo.owners = ["owner-1"];
  sweepRepo.rows = [machine()];
  return { jobs, sweepRepo, zone: "Africa/Johannesburg" };
}

describe("which day a run belongs to", () => {
  it("is REEF's calendar day, not the day it is in UTC", () => {
    // 22:30 UTC on the 3rd is 00:30 on the 4th in South Africa. Filed against the 3rd, "did
    // the sweep run on the 4th" could never be answered from the table.
    const at = new Date("2026-10-03T22:30:00Z");
    expect(dayIn("Africa/Johannesburg", at)).toBe("2026-10-04");
    expect(dayIn("UTC", at)).toBe("2026-10-03");
  });
});

describe("claiming the day", () => {
  it("runs the sweep and records what it did", async () => {
    const d = deps();
    expect(await runSweepFor(d, "2026-10-04")).toBe(true);
    const run = d.jobs.rows[0]!;
    expect(run.outcome).toBe("ok");
    expect(run.detail).toContain("1 raised");
    expect(run.finished_at).not.toBeNull();
  });

  it("lets exactly one of two processes do the work", async () => {
    // Read-then-write would let both see no run and both sweep. Claiming by insert is why
    // only one can win, and this is the test that would fail if it were loosened.
    const d = deps();
    const [a, b] = await Promise.all([runSweepFor(d, "2026-10-04"), runSweepFor(d, "2026-10-04")]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(d.jobs.rows).toHaveLength(1);
    expect(d.sweepRepo.raised).toHaveLength(1);
  });

  it("records a failed run rather than leaving it unfinished", async () => {
    // An unfinished row and a crashed process look identical from outside, and only one of
    // them can be acted on.
    const d = deps();
    d.sweepRepo.failWith = new Error("database unreachable");
    await expect(runSweepFor(d, "2026-10-04")).rejects.toThrow("database unreachable");
    expect(d.jobs.rows[0]!.outcome).toBe("failed");
    expect(d.jobs.rows[0]!.detail).toBe("database unreachable");
  });

  it("does not sweep twice on the same day after a restart", async () => {
    const d = deps();
    await runSweepFor(d, "2026-10-04");
    expect(await runSweepFor(d, "2026-10-04")).toBe(false);
    expect(d.sweepRepo.raised).toHaveLength(1);
  });
});

describe("the report of what ran", () => {
  it("lists the days that have no run at all", async () => {
    const d = deps();
    await runSweepFor(d, "2026-10-01");
    await runSweepFor(d, "2026-10-04");
    const runs = await d.jobs.runs(SERVICE_SWEEP, "2026-10-01", "2026-10-05");
    const r = report(SERVICE_SWEEP, "2026-10-01", "2026-10-05", runs);
    expect(r.missed).toEqual(["2026-10-02", "2026-10-03", "2026-10-05"]);
    expect(r.last_success).toBe("2026-10-04");
  });

  it("counts both ends of the range", () => {
    expect(daysBetween("2026-10-01", "2026-10-03")).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
  });

  it("reports no successes as null rather than as a date", () => {
    expect(report("j", "2026-10-01", "2026-10-02", []).last_success).toBeNull();
  });
});

describe("the jobs endpoint", () => {
  it("is the owner's alone", () => {
    expect(PERMISSIONS["jobs:read"]).toEqual(["owner"]);
  });

  it("refuses a manager and a worker", async () => {
    const { call } = testApp();
    expect((await call("GET", "/api/v1/admin/jobs", { token: "manager-token" })).status).toBe(403);
    expect((await call("GET", "/api/v1/admin/jobs", { token: "worker-token" })).status).toBe(403);
  });

  it("answers the owner, and names the missed days", async () => {
    const { call, jobs } = testApp();
    await jobs.claim(SERVICE_SWEEP, "2026-10-02");
    await jobs.finish(SERVICE_SWEEP, "2026-10-02", "ok", "nothing due");
    const res = await call("GET", "/api/v1/admin/jobs?from=2026-10-01&to=2026-10-03", {
      token: "owner-token",
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.missed).toEqual(["2026-10-01", "2026-10-03"]);
    expect(data.last_success).toBe("2026-10-02");
  });
});
