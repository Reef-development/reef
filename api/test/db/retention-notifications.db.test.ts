import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, type Db } from "./harness.js";

// T11A and T24 against a real Postgres. Three of the things these tasks rest on cannot be
// tested against the in-memory fakes at all, because a fake has no constraints, no row-level
// security and no SECURITY DEFINER functions:
//
//   * the suppression rule really suppresses, through an ON CONFLICT the database accepts
//   * claiming a day really excludes a second claim
//   * identity numbers are reachable only through a function, and only by the owner
//
// The first of those is where the first version of this work was wrong.

let db: Db;
let owner: string;
let manager: string;

beforeAll(async () => {
  db = await migratedDb();
  owner = await db.user("owner");
  manager = await db.user("manager");
}, 60_000);

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0];

async function newEmployee(name: string) {
  return one<{ id: string }>("INSERT INTO employees (full_name) VALUES ($1) RETURNING id", [name]);
}

describe("the notification suppression, against a real database", () => {
  async function raise(userId: string, key: string) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO notifications (user_id, kind, subject, body, dedupe_key)
       VALUES ($1, 'service_due', 's', 'b', $2)
       ON CONFLICT (user_id, dedupe_key) DO NOTHING
       RETURNING id`,
      [userId, key],
    );
    return rows.length;
  }

  it("accepts the ON CONFLICT the API actually sends", async () => {
    // This is the whole point of the test. A partial unique index would reject this statement
    // with 42P10 unless it repeated the index predicate, and PostgREST cannot send a predicate,
    // so the sweep would have failed every time while every fake test passed.
    await expect(raise(owner, "service_due:m1:date:2026-09-30")).resolves.toBe(1);
  });

  it("creates the first and suppresses the second", async () => {
    const key = "service_due:m2:date:2026-09-30";
    expect(await raise(owner, key)).toBe(1);
    expect(await raise(owner, key)).toBe(0);
    const { count } = await one<{ count: string }>(
      "SELECT count(*)::text AS count FROM notifications WHERE dedupe_key = $1",
      [key],
    );
    expect(count).toBe("1");
  });

  it("keeps two people's copies of the same reminder apart", async () => {
    const key = "service_due:m3:date:2026-09-30";
    expect(await raise(owner, key)).toBe(1);
    expect(await raise(manager, key)).toBe(1);
  });

  it("refuses a notification with no key, so one can never silently repeat", async () => {
    await expect(
      db.query(
        "INSERT INTO notifications (user_id, kind, subject, body) VALUES ($1, 'service_due', 's', 'b')",
        [owner],
      ),
    ).rejects.toThrow(/dedupe_key/);
  });

  it("lets a person read only their own, whatever their role", async () => {
    await raise(owner, "service_due:m4:date:2026-09-30");
    await raise(manager, "service_due:m5:date:2026-09-30");
    const mine = await db.as(manager, async (tx) =>
      tx.query<{ user_id: string }>("SELECT user_id FROM notifications"),
    );
    expect(mine.rows.every((r) => r.user_id === manager)).toBe(true);
    expect(mine.rows.length).toBeGreaterThan(0);
  });

  it("does not let a signed-in user create one at all", async () => {
    // Notifications are raised by the sweep, which runs as the service role. There is no insert
    // policy for authenticated, so nobody can send themselves or anybody else a notification.
    await expect(
      db.as(owner, async (tx) =>
        tx.query(
          "INSERT INTO notifications (user_id, kind, subject, body, dedupe_key) VALUES ($1, 'service_due', 's', 'b', 'x')",
          [owner],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("claiming a day, against a real database", () => {
  it("lets the first claim through and refuses the second", async () => {
    const claim = () =>
      db.query("INSERT INTO job_runs (job, ran_for) VALUES ('service_due_sweep', '2026-10-04')");
    await expect(claim()).resolves.toBeDefined();
    await expect(claim()).rejects.toThrow();
  });

  it("is the owner's to read", async () => {
    const asOwner = await db.as(owner, async (tx) => tx.query("SELECT * FROM job_runs"));
    expect(asOwner.rows.length).toBeGreaterThan(0);
    const asManager = await db.as(manager, async (tx) => tx.query("SELECT * FROM job_runs"));
    expect(asManager.rows).toHaveLength(0);
  });
});

describe("identity numbers, after T11 moved them", () => {
  it("are not a column on employees any more", async () => {
    const { count } = await one<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.columns
       WHERE table_name = 'employees' AND column_name = 'id_number'`,
    );
    expect(count).toBe("0");
  });

  it("are counted through the function, which returns ids and no numbers", async () => {
    const employee = await newEmployee("Thandi Mokoena");
    await db.query(
      "INSERT INTO employee_personal_information (employee_id, id_number) VALUES ($1, '0000000000000')",
      [employee.id],
    );
    const held = await db.as(owner, async (tx) =>
      tx.query<{ employee_id: string }>("SELECT * FROM employees_holding_identity_number()"),
    );
    expect(held.rows.map((r) => r.employee_id)).toContain(employee.id);
    expect(JSON.stringify(held.rows)).not.toContain("0000000000000");
  });

  it("are refused to a manager, by the function rather than by the screen", async () => {
    await expect(
      db.as(manager, async (tx) => tx.query("SELECT * FROM employees_holding_identity_number()")),
    ).rejects.toThrow();
  });

  it("leave the leaving date on the employee row, where both periods are measured from", async () => {
    const { count } = await one<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.columns
       WHERE table_name = 'employees' AND column_name = 'left_on'`,
    );
    expect(count).toBe("1");
  });
});
