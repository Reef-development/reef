import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { PERMISSIONS } from "@reef/shared";
import { allDue, message, serviceDue, type Machine } from "../src/services/service-due.js";
import { describe as describeSweep, sweep } from "../src/services/sweep.js";
import { MemorySweep, testApp, USERS } from "./fakes.js";

function machine(over: Partial<Machine> = {}): Machine {
  return {
    id: randomUUID(),
    name: "Wash plant pump",
    mine_id: "00000000-0000-4000-8000-0000000000a1",
    status: "active",
    install_date: "2026-01-01",
    tons_since_install: 0,
    service_interval_days: 90,
    service_interval_tons: null,
    next_due_date: null,
    next_due_tons: null,
    last_serviced_on: null,
    ...over,
  };
}

describe("when a machine is due a service", () => {
  it("is due on the day it falls due, not the day after", () => {
    const m = machine({ next_due_date: "2026-10-04" });
    expect(serviceDue(m, "2026-10-03")).toBeNull();
    expect(serviceDue(m, "2026-10-04")?.reason).toBe("date");
  });

  it("is due on tons once the threshold is passed", () => {
    const m = machine({
      service_interval_days: null,
      next_due_tons: 5000,
      tons_since_install: 5000,
    });
    expect(serviceDue(m, "2026-10-04")?.reason).toBe("tons");
  });

  it("prefers the date when both are overdue, so it reads as late rather than busy", () => {
    const m = machine({
      next_due_date: "2026-09-01",
      next_due_tons: 5000,
      tons_since_install: 9000,
    });
    expect(serviceDue(m, "2026-10-04")?.reason).toBe("date");
  });

  it("counts from the last service rather than from installation", () => {
    // An engineer who wrote a next due date on the job card knew something the interval did not.
    const m = machine({
      install_date: "2026-01-01",
      last_serviced_on: "2026-09-20",
      service_interval_days: 90,
    });
    expect(serviceDue(m, "2026-10-04")).toBeNull();
  });

  it("is never due when nothing has been set", () => {
    // A reminder raised against a figure nobody entered teaches people to ignore reminders.
    const m = machine({ service_interval_days: null, service_interval_tons: null });
    expect(serviceDue(m, "2030-01-01")).toBeNull();
  });

  it("is never due for a machine that is not active", () => {
    const m = machine({ status: "retired", next_due_date: "2020-01-01" });
    expect(serviceDue(m, "2026-10-04")).toBeNull();
  });

  it("keys the reminder on the threshold, so the same machine due again raises again", () => {
    const first = serviceDue(machine({ id: "m1", next_due_date: "2026-07-01" }), "2026-10-04");
    const after = serviceDue(machine({ id: "m1", next_due_date: "2026-11-01" }), "2026-11-02");
    expect(first?.dedupe_key).not.toBe(after?.dedupe_key);
  });

  it("writes a message a person can act on without opening the system", () => {
    const due = serviceDue(
      machine({ name: "Screen deck", next_due_date: "2026-09-30" }),
      "2026-10-04",
    );
    const { subject, body } = message(due!);
    expect(subject).toContain("Screen deck");
    expect(body).toContain("2026-09-30");
  });

  it("lists everything due in the same order twice", () => {
    const machines = [
      machine({ name: "Zebra", next_due_date: "2026-01-01" }),
      machine({ name: "Alpha", next_due_date: "2026-01-01" }),
    ];
    expect(allDue(machines, "2026-10-04").map((d) => d.equipment_name)).toEqual(["Alpha", "Zebra"]);
  });
});

describe("the sweep", () => {
  let repo: MemorySweep;

  beforeEach(() => {
    repo = new MemorySweep();
    repo.people = ["user-owner", "user-manager"];
    repo.rows = [machine({ id: "m1", name: "Pump", next_due_date: "2026-09-01" })];
  });

  it("raises one notification per person on the first run", async () => {
    const result = await sweep(repo, "2026-10-04");
    expect(result.due).toBe(1);
    expect(result.raised).toBe(2);
  });

  it("raises nothing on the second run, and the first run really did create something", async () => {
    // Both halves matter. Asserting only that the second run raises nothing would pass even if
    // the first one had silently failed and created no notification at all.
    const first = await sweep(repo, "2026-10-04");
    const second = await sweep(repo, "2026-10-05");
    expect(first.raised).toBe(2);
    expect(second.raised).toBe(0);
    expect(repo.raised).toHaveLength(2);
  });

  it("names a machine nobody can be told about rather than passing over it", async () => {
    repo.people = [];
    const result = await sweep(repo, "2026-10-04");
    expect(result.raised).toBe(0);
    expect(result.without_recipients).toEqual(["Pump"]);
  });

  it("gives every notification a key, because the table requires one", async () => {
    // The suppression rule is a unique constraint over every row rather than a partial index,
    // so a draft with no key would be rejected by the database rather than quietly repeating.
    // This is the check that catches it here, where there is no database.
    repo.rows = [
      machine({ id: "m1", name: "Pump", next_due_date: "2026-09-01" }),
      machine({
        id: "m2",
        name: "Screen",
        service_interval_days: null,
        next_due_tons: 100,
        tons_since_install: 500,
      }),
    ];
    await sweep(repo, "2026-10-04");
    expect(repo.raised).not.toHaveLength(0);
    for (const draft of repo.raised) {
      expect(draft.dedupe_key).toBeTruthy();
    }
  });

  it("describes a run in one line", async () => {
    const result = await sweep(repo, "2026-10-04");
    expect(describeSweep(result)).toBe("1 machines, 1 due, 2 raised");
  });
});

describe("the notification endpoints", () => {
  it("are open to every role, because everybody has their own", () => {
    expect(PERMISSIONS["notifications:read"]).toEqual(["owner", "manager", "worker"]);
  });

  it("answer a worker with their own notifications and nobody else's", async () => {
    const { call, notifications } = testApp();
    const mine = USERS["worker-token"]!.id;
    const theirs = USERS["manager-token"]!.id;
    for (const [user, subject] of [
      [mine, "Mine"],
      [theirs, "Not mine"],
    ] as const) {
      notifications.rows.push({
        id: randomUUID(),
        user_id: user,
        kind: "service_due",
        subject,
        body: "b",
        equipment_id: null,
        mine_id: null,
        dedupe_key: subject,
        created_at: new Date().toISOString(),
        read_at: null,
      });
    }
    const res = await call("GET", "/api/v1/notifications", { token: "worker-token" });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.map((n: { subject: string }) => n.subject)).toEqual(["Mine"]);
  });

  it("refuse to mark somebody else's notification read, as a not found", async () => {
    const { call, notifications } = testApp();
    const id = randomUUID();
    notifications.rows.push({
      id,
      user_id: USERS["manager-token"]!.id,
      kind: "service_due",
      subject: "s",
      body: "b",
      equipment_id: null,
      mine_id: null,
      dedupe_key: "not-mine",
      created_at: new Date().toISOString(),
      read_at: null,
    });
    // Not 403: a refusal would confirm that the notification exists.
    const res = await call("PATCH", `/api/v1/notifications/${id}/read`, { token: "worker-token" });
    expect(res.status).toBe(404);
  });

  it("mark a notification read once, and not twice", async () => {
    const { call, notifications } = testApp();
    const id = randomUUID();
    notifications.rows.push({
      id,
      user_id: USERS["worker-token"]!.id,
      kind: "service_due",
      subject: "s",
      body: "b",
      equipment_id: null,
      mine_id: null,
      dedupe_key: "mine",
      created_at: new Date().toISOString(),
      read_at: null,
    });
    expect(
      (await call("PATCH", `/api/v1/notifications/${id}/read`, { token: "worker-token" })).status,
    ).toBe(200);
    expect(
      (await call("PATCH", `/api/v1/notifications/${id}/read`, { token: "worker-token" })).status,
    ).toBe(404);
  });
});
