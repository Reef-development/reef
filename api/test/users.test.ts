import { describe, expect, it } from "vitest";
import { testApp, USERS } from "./fakes.js";

const WORKER = USERS["worker-token"].id;
const OWNER = USERS["owner-token"].id;

describe("T22 admin: the owner's user list", () => {
  it("lists everyone with their role", async () => {
    const res = await testApp().call("GET", "/api/v1/users", { token: "owner-token" });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.find((u: { id: string }) => u.id === WORKER)).toMatchObject({ role: "worker" });
  });

  it("refuses a manager and a worker", async () => {
    const t = testApp();
    expect((await t.call("GET", "/api/v1/users", { token: "manager-token" })).status).toBe(403);
    expect((await t.call("GET", "/api/v1/users", { token: "worker-token" })).status).toBe(403);
  });
});

describe("T22 admin: changing someone's role", () => {
  it("changes it and records the old role, the new one and why in the history", async () => {
    const { call, history } = testApp();
    const res = await call("PATCH", `/api/v1/users/${WORKER}/role`, {
      token: "owner-token",
      body: { role: "manager", reason: "Promoted to shift supervisor at Kriel" },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ id: WORKER, role: "manager" });
    expect(history.rows.at(-1)).toMatchObject({
      table_name: "user_roles",
      row_id: WORKER,
      changed_by: OWNER,
      reason: "Promoted to shift supervisor at Kriel",
      old_values: { role: "worker" },
      new_values: { role: "manager" },
    });
  });

  it("offers exactly the three real roles: any other is refused", async () => {
    const { call } = testApp();
    for (const role of ["supervisor", "stock_controller", "admin", ""]) {
      const res = await call("PATCH", `/api/v1/users/${WORKER}/role`, {
        token: "owner-token",
        body: { role, reason: "Trying an old role" },
      });
      expect(res.status).toBe(400);
    }
  });

  it("requires a reason", async () => {
    const { call, history } = testApp();
    for (const body of [{ role: "manager" }, { role: "manager", reason: "   " }]) {
      const res = await call("PATCH", `/api/v1/users/${WORKER}/role`, {
        token: "owner-token",
        body,
      });
      expect(res.status).toBe(400);
    }
    expect(history.rows).toHaveLength(0);
  });

  it("refuses a manager changing roles, including their own", async () => {
    const res = await testApp().call("PATCH", `/api/v1/users/${USERS["manager-token"].id}/role`, {
      token: "manager-token",
      body: { role: "owner", reason: "Promoting myself" },
    });
    expect(res.status).toBe(403);
  });

  it("will not remove the last owner, so roles can always be managed", async () => {
    const res = await testApp().call("PATCH", `/api/v1/users/${OWNER}/role`, {
      token: "owner-token",
      body: { role: "worker", reason: "Stepping back" },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(/at least one owner/);
  });

  it("answers 404 for an account that does not exist, and 400 for an id that is not one", async () => {
    const { call } = testApp();
    const missing = await call("PATCH", "/api/v1/users/00000000-0000-4000-8000-0000000000ff/role", {
      token: "owner-token",
      body: { role: "worker", reason: "Tidy up" },
    });
    expect(missing.status).toBe(404);
    const bad = await call("PATCH", "/api/v1/users/nope/role", {
      token: "owner-token",
      body: { role: "worker", reason: "Tidy up" },
    });
    expect(bad.status).toBe(400);
  });
});
