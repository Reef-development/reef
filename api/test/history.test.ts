import { describe, expect, it } from "vitest";
import { testApp, USERS } from "./fakes.js";

const REASON = "Adjusted the target after the new haulage contract";
const NEW_REASON = "Fixed the team name after the site transfer";

async function withSite() {
  const t = testApp();
  const res = await t.call("POST", "/api/v1/mines", {
    token: "owner-token",
    body: { name: "Kriel Plant 2", location: "Mpumalanga", team_name: "Alpha" },
  });
  const { data } = await res.json();
  return { ...t, id: data.id as string };
}

describe("T6: a change writes a history row", () => {
  it("writes exactly one row after a successful update", async () => {
    const { call, history, id } = await withSite();
    expect(history.rows).toHaveLength(0);

    const res = await call("PATCH", `/api/v1/mines/${id}`, {
      token: "owner-token",
      body: { target_cost_per_ton: 52, version: 1, reason: REASON },
    });
    expect(res.status).toBe(200);
    expect(history.rows).toHaveLength(1);
  });

  it("records the table, the row, the actor, the reason, and the version", async () => {
    const { call, history, id } = await withSite();
    await call("PATCH", `/api/v1/mines/${id}`, {
      token: "owner-token",
      body: { target_cost_per_ton: 52, version: 1, reason: REASON },
    });

    const entry = history.rows[0];
    expect(entry.table_name).toBe("mines");
    expect(entry.row_id).toBe(id);
    expect(entry.changed_by).toBe(USERS["owner-token"].id);
    expect(entry.reason).toBe(REASON);
    expect(entry.version).toBe(2);
  });

  it("records only the columns that changed", async () => {
    const { call, history, id } = await withSite();
    await call("PATCH", `/api/v1/mines/${id}`, {
      token: "owner-token",
      body: { target_cost_per_ton: 52, version: 1, reason: REASON },
    });

    const entry = history.rows[0];
    // Only the target changed. Everything else in the row (name, location, team_name) is
    // identical in the before and after, so it does not appear in either half of the diff.
    expect(entry.old_values).toHaveProperty("target_cost_per_ton");
    expect(entry.new_values).toHaveProperty("target_cost_per_ton");
    expect(entry.old_values.target_cost_per_ton).toBeNull();
    expect(entry.new_values.target_cost_per_ton).toBe(52);
    expect(entry.old_values).not.toHaveProperty("name");
    expect(entry.old_values).not.toHaveProperty("location");
    expect(entry.new_values).not.toHaveProperty("name");
    expect(entry.new_values).not.toHaveProperty("location");
  });

  it("writes one row per change, so a second change is a second row", async () => {
    const { call, history, id } = await withSite();
    await call("PATCH", `/api/v1/mines/${id}`, {
      token: "owner-token",
      body: { target_cost_per_ton: 52, version: 1, reason: REASON },
    });
    await call("PATCH", `/api/v1/mines/${id}`, {
      token: "manager-token",
      body: { team_name: "Bravo", version: 2, reason: NEW_REASON },
    });

    expect(history.rows).toHaveLength(2);
    expect(history.rows[0].reason).toBe(REASON);
    expect(history.rows[1].reason).toBe(NEW_REASON);
    expect(history.rows[1].changed_by).toBe(USERS["manager-token"].id);
    expect(history.rows[1].version).toBe(3);
  });
});

describe("T6: a refused change does not write a history row", () => {
  it("does not write history when the version is stale", async () => {
    const { call, history, id } = await withSite();
    // First change lands.
    await call("PATCH", `/api/v1/mines/${id}`, {
      token: "owner-token",
      body: { target_cost_per_ton: 52, version: 1, reason: REASON },
    });
    expect(history.rows).toHaveLength(1);

    // Second change sends version 1 again. It is refused with 409 and no new history row.
    const res = await call("PATCH", `/api/v1/mines/${id}`, {
      token: "owner-token",
      body: { target_cost_per_ton: 99, version: 1, reason: NEW_REASON },
    });
    expect(res.status).toBe(409);
    expect(history.rows).toHaveLength(1);
  });

  it("does not write history when the record does not exist", async () => {
    const { call, history } = await withSite();
    const res = await call("PATCH", "/api/v1/mines/00000000-0000-4000-8000-00000000abcd", {
      token: "owner-token",
      body: { target_cost_per_ton: 52, version: 1, reason: REASON },
    });
    expect(res.status).toBe(404);
    expect(history.rows).toHaveLength(0);
  });

  it("does not write history when the reason is missing", async () => {
    const { call, history, id } = await withSite();
    const res = await call("PATCH", `/api/v1/mines/${id}`, {
      token: "owner-token",
      body: { target_cost_per_ton: 52, version: 1 },
    });
    expect(res.status).toBe(400);
    expect(history.rows).toHaveLength(0);
  });

  it("does not write history when the caller is refused by the permission check", async () => {
    const { call, history, id } = await withSite();
    const res = await call("PATCH", `/api/v1/mines/${id}`, {
      token: "worker-token",
      body: { target_cost_per_ton: 52, version: 1, reason: REASON },
    });
    expect(res.status).toBe(403);
    expect(history.rows).toHaveLength(0);
  });
});

describe("T6: creating a record does not write history", () => {
  it("leaves the history empty after a create", async () => {
    const { history } = await withSite();
    expect(history.rows).toHaveLength(0);
  });
});

describe("T6: the reason comes back when the history is read", () => {
  it("returns the reason with the old and new values, newest first", async () => {
    const { call, id } = await withSite();
    await call("PATCH", `/api/v1/mines/${id}`, {
      token: "owner-token",
      body: { target_cost_per_ton: 52, version: 1, reason: REASON },
    });
    await call("PATCH", `/api/v1/mines/${id}`, {
      token: "owner-token",
      body: { team_name: "Bravo", version: 2, reason: NEW_REASON },
    });

    const res = await call("GET", `/api/v1/history?table=mines&row_id=${id}`, {
      token: "owner-token",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.total).toBe(2);
    expect(body.data[0]).toMatchObject({
      reason: NEW_REASON,
      old_values: { team_name: "Alpha" },
      new_values: { team_name: "Bravo" },
    });
    expect(body.data[1].reason).toBe(REASON);
  });

  it("shows only the record asked for", async () => {
    const { call, id } = await withSite();
    const other = await call("POST", "/api/v1/mines", {
      token: "owner-token",
      body: { name: "Ogies" },
    });
    const otherId = (await other.json()).data.id;
    await call("PATCH", `/api/v1/mines/${otherId}`, {
      token: "owner-token",
      body: { name: "Ogies North", version: 1, reason: REASON },
    });

    const res = await call("GET", `/api/v1/history?table=mines&row_id=${id}`, {
      token: "owner-token",
    });
    expect((await res.json()).data).toHaveLength(0);
  });

  it("lets a manager read it, and refuses a worker", async () => {
    const { call } = await withSite();
    expect((await call("GET", "/api/v1/history", { token: "manager-token" })).status).toBe(200);
    expect((await call("GET", "/api/v1/history", { token: "worker-token" })).status).toBe(403);
  });

  it("answers 400 for a record id that is not an id", async () => {
    const { call } = await withSite();
    const res = await call("GET", "/api/v1/history?row_id=nope", { token: "owner-token" });
    expect(res.status).toBe(400);
  });
});
