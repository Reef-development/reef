import { describe, expect, it } from "vitest";
import { addYears, dueDates, EMPLOYEE_PERSONAL_FIELDS, PERMISSIONS } from "@reef/shared";
import { loadConfig } from "../src/config.js";
import { retentionPlan } from "../src/services/retention.js";
import { testApp } from "./fakes.js";

const YEARS = { identity: 5, record: 7 };

function leaver(over: Partial<Parameters<typeof retentionPlan>[0][number]> = {}) {
  return {
    id: "00000000-0000-4000-8000-00000000000a",
    full_name: "Thandi Mokoena",
    employee_no: "E-1042",
    left_on: "2019-06-30",
    id_number_held: true,
    ...over,
  };
}

describe("the date the period falls due", () => {
  it("is the anniversary, not a day before it", () => {
    expect(addYears("2019-06-30", 5)).toBe("2024-06-30");
  });

  it("rolls 29 February back to 28 February rather than forward into March", () => {
    // Rolling forward would keep an identity number one day longer than the rule allows, which
    // is the wrong direction to be wrong in.
    expect(addYears("2020-02-29", 5)).toBe("2025-02-28");
  });

  it("gives the record a later date than the identity number, for the same person", () => {
    const due = dueDates("2019-06-30", YEARS);
    expect(due.identity < due.record).toBe(true);
  });
});

describe("what is due", () => {
  it("is not due the day before the anniversary and is due on it", () => {
    const before = retentionPlan([leaver()], YEARS, "2024-06-29");
    const on = retentionPlan([leaver()], YEARS, "2024-06-30");
    expect(before.identity_due_now).toBe(0);
    expect(on.identity_due_now).toBe(1);
  });

  it("does not count a number that has already been removed", () => {
    // Otherwise the list grows rather than shrinks as the removal job does its work, and
    // nobody can tell whether the job is running.
    const plan = retentionPlan([leaver({ id_number_held: false })], YEARS, "2030-01-01");
    expect(plan.identity_due_now).toBe(0);
    expect(plan.items[0]?.identity_due).toBe(false);
    expect(plan.record_due_now).toBe(1);
  });

  it("puts the soonest due first, whatever order the records arrive in", () => {
    const plan = retentionPlan(
      [leaver({ id: "b", left_on: "2022-01-01" }), leaver({ id: "a", left_on: "2018-01-01" })],
      YEARS,
      "2026-01-01",
    );
    expect(plan.items.map((i) => i.employee_id)).toEqual(["a", "b"]);
  });

  it("answers as at the date it is given, so it does not change overnight", () => {
    const plan = retentionPlan([leaver()], YEARS, "2026-09-30");
    expect(plan.as_of).toBe("2026-09-30");
    expect(plan.years).toEqual(YEARS);
  });
});

describe("the settings", () => {
  const base = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "key",
  };

  it("fall back to five years and seven years", () => {
    expect(loadConfig(base as NodeJS.ProcessEnv).retention).toEqual({ identity: 5, record: 7 });
  });

  it("refuse an identity period longer than the record it sits in", () => {
    expect(() =>
      loadConfig({
        ...base,
        RETENTION_IDENTITY_YEARS: "9",
        RETENTION_RECORD_YEARS: "7",
      } as NodeJS.ProcessEnv),
    ).toThrow(/RETENTION_IDENTITY_YEARS/);
  });
});

describe("the retention endpoint", () => {
  it("is the owner's alone", () => {
    expect(PERMISSIONS["retention:read"]).toEqual(["owner"]);
  });

  it("refuses a manager and a worker", async () => {
    const { call } = testApp();
    expect((await call("GET", "/api/v1/admin/retention", { token: "manager-token" })).status).toBe(
      403,
    );
    expect((await call("GET", "/api/v1/admin/retention", { token: "worker-token" })).status).toBe(
      403,
    );
  });

  it("answers the owner, and never puts an identity number in the body", async () => {
    const { call, retention } = testApp();
    retention.rows = [leaver()];
    const res = await call("GET", "/api/v1/admin/retention?as_of=2026-09-30", {
      token: "owner-token",
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toMatch(/id_number"\s*:/);
    const { data } = JSON.parse(body);
    expect(data.identity_due_now).toBe(1);
    expect(data.items[0].identity_number_held).toBe(true);
    expect(data.items[0].identity_due_on).toBe("2024-06-30");
  });

  it("refuses an as_of that is not a date", async () => {
    const { call } = testApp();
    const res = await call("GET", "/api/v1/admin/retention?as_of=last%20year", {
      token: "owner-token",
    });
    expect(res.status).toBe(400);
  });
});

describe("the field list", () => {
  it("names the identity number under the shorter period and nothing else", () => {
    const identity = EMPLOYEE_PERSONAL_FIELDS.filter((f) => f.period === "identity");
    expect(identity.map((f) => f.column)).toEqual(["employee_personal_information.id_number"]);
  });

  it("covers every personal column of employees, so the removal job has a list to act on", () => {
    // If a personal column is added to the table and not added here, this is the test that is
    // meant to be updated. It exists so that the omission is a decision rather than an oversight.
    expect(EMPLOYEE_PERSONAL_FIELDS.map((f) => f.column)).toEqual([
      "employee_personal_information.id_number",
      "full_name",
      "employee_no",
      "phone",
      "position",
      "team_name",
      "shift",
      "hourly_rate",
      "hire_date",
      "notes",
    ]);
  });
});
