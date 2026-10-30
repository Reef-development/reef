import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, type Db } from "./harness.js";

// The user-admin functions against a real Postgres: who may call them, and the rules they keep
// even if the API's own check were missing.

let db: Db;
let owner: string;
let manager: string;
let worker: string;

beforeAll(async () => {
  db = await migratedDb();
  owner = await db.user("owner");
  manager = await db.user("manager");
  worker = await db.user("worker");
}, 60_000);

const listAs = (userId: string) =>
  db.as(userId, (tx) => tx.query<{ id: string; role: string }>("SELECT * FROM list_users()"));
const setRoleAs = (userId: string, target: string, role: string, reason: string | null) =>
  db.as(userId, (tx) =>
    tx.query<{ id: string; role: string }>("SELECT * FROM set_user_role($1, $2, $3)", [
      target,
      role,
      reason,
    ]),
  );
const roleOf = async (id: string) =>
  (await db.query<{ role: string }>("SELECT role_of($1) AS role", [id])).rows[0].role;

describe("T22 admin: list_users", () => {
  it("shows the owner everyone, with their role", async () => {
    const { rows } = await listAs(owner);
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([owner, manager, worker]));
    expect(rows.find((r) => r.id === worker)?.role).toBe("worker");
  });

  it("refuses a manager and a worker in the database itself", async () => {
    await expect(listAs(manager)).rejects.toThrow(/Only the owner/);
    await expect(listAs(worker)).rejects.toThrow(/Only the owner/);
  });
});

describe("T22 admin: set_user_role", () => {
  it("changes the role and writes the old and new role, and why, to the history", async () => {
    const someone = await db.user("worker");
    const { rows } = await setRoleAs(owner, someone, "manager", " Took over the night shift ");
    expect(rows[0].role).toBe("manager");
    expect(await roleOf(someone)).toBe("manager");
    const history = await db.query<{
      reason: string;
      old_values: object;
      new_values: object;
      changed_by: string;
    }>("SELECT * FROM history WHERE table_name = 'user_roles' AND row_id = $1", [someone]);
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0]).toMatchObject({
      reason: "Took over the night shift",
      changed_by: owner,
      old_values: { role: "worker" },
      new_values: { role: "manager" },
    });
  });

  it("refuses a manager, even changing themselves", async () => {
    await expect(setRoleAs(manager, manager, "owner", "Promoting myself")).rejects.toThrow(
      /Only the owner/,
    );
    expect(await roleOf(manager)).toBe("manager");
  });

  it("refuses a role other than the three, and a missing reason", async () => {
    await expect(setRoleAs(owner, worker, "supervisor", "Old role")).rejects.toThrow(
      /owner, manager or worker/,
    );
    await expect(setRoleAs(owner, worker, "manager", "  ")).rejects.toThrow(/reason is required/);
    expect(await roleOf(worker)).toBe("worker");
  });

  it("never leaves the platform without an owner", async () => {
    await expect(setRoleAs(owner, owner, "worker", "Stepping back")).rejects.toThrow(
      /at least one owner/,
    );
    // With a second owner, the first may step back.
    const second = await db.user("worker");
    await setRoleAs(owner, second, "owner", "Co-owner from October");
    const { rows } = await setRoleAs(owner, owner, "manager", "Handing over to the co-owner");
    expect(rows[0].role).toBe("manager");
  });

  it("writes nothing when the role is already the one asked for", async () => {
    const someone = await db.user("worker");
    // The first owner stepped back in the test above; ask whoever is an owner now.
    const current = (
      await db.query<{ id: string }>(
        "SELECT user_id AS id FROM user_roles WHERE role = 'owner' LIMIT 1",
      )
    ).rows[0].id;
    await setRoleAs(current, someone, "worker", "No change");
    const n = await db.query<{ n: number }>(
      "SELECT count(*)::int n FROM history WHERE table_name = 'user_roles' AND row_id = $1",
      [someone],
    );
    expect(n.rows[0].n).toBe(0);
  });
});
