import { describe, expect, it } from "vitest";
import { testApp } from "./fakes.js";

const REASON = "Adjusting the site record";

async function withSite() {
  const t = testApp();
  const res = await t.call("POST", "/api/v1/mines", {
    token: "owner-token",
    body: { name: "Kriel Plant 2" },
  });
  const { data } = await res.json();
  return { ...t, id: data.id as string };
}

describe("T8: every record carries a version", () => {
  it("returns version 1 on a new record, from create and from read", async () => {
    const { call, id } = await withSite();
    const res = await call("GET", `/api/v1/mines/${id}`, { token: "worker-token" });
    expect(await res.json()).toMatchObject({ data: { id, version: 1 } });
  });

  it("raises the version by one on each successful change", async () => {
    const { call, id } = await withSite();
    const first = await call("PATCH", `/api/v1/mines/${id}`, {
      token: "owner-token",
      body: { location: "Kriel", version: 1, reason: REASON },
    });
    expect(await first.json()).toMatchObject({ data: { version: 2 } });
    const second = await call("PATCH", `/api/v1/mines/${id}`, {
      token: "owner-token",
      body: { team_name: "Alpha", version: 2, reason: REASON },
    });
    expect(await second.json()).toMatchObject({
      data: { version: 3, location: "Kriel", team_name: "Alpha" },
    });
  });
});

describe("T8: a change from an out-of-date copy is refused", () => {
  it("refuses a change with no version at all", async () => {
    const { call, id } = await withSite();
    const res = await call("PATCH", `/api/v1/mines/${id}`, {
      token: "owner-token",
      body: { location: "Kriel", reason: REASON },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.details).toContainEqual(expect.objectContaining({ path: "version" }));
  });

  it("refuses a change with no reason at all", async () => {
    const { call, id } = await withSite();
    const res = await call("PATCH", `/api/v1/mines/${id}`, {
      token: "owner-token",
      body: { location: "Kriel", version: 1 },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.details).toContainEqual(expect.objectContaining({ path: "reason" }));
  });

  it("refuses an old version with 409, says why, and sends back the current copy", async () => {
    const { call, id, mines } = await withSite();
    await call("PATCH", `/api/v1/mines/${id}`, {
      token: "manager-token",
      body: { location: "Ogies", version: 1, reason: REASON },
    });

    const res = await call("PATCH", `/api/v1/mines/${id}`, {
      token: "owner-token",
      body: { location: "Kriel", version: 1, reason: REASON },
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message).toMatch(/someone else changed this site/i);
    expect(body.error.details.current).toMatchObject({ location: "Ogies", version: 2 });
    expect(mines.rows[0]).toMatchObject({ location: "Ogies", version: 2 });
  });

  it("does not let a client choose its own version number", async () => {
    const { call, id, mines } = await withSite();
    const res = await call("PATCH", `/api/v1/mines/${id}`, {
      token: "owner-token",
      body: { location: "Kriel", version: 99, reason: REASON },
    });
    expect(res.status).toBe(409);
    expect(mines.rows[0].version).toBe(1);
  });

  it("answers 404, not 409, when the record no longer exists", async () => {
    const res = await testApp().call(
      "PATCH",
      "/api/v1/mines/00000000-0000-4000-8000-00000000abcd",
      {
        token: "owner-token",
        body: { location: "Kriel", version: 1, reason: REASON },
      },
    );
    expect(res.status).toBe(404);
  });
});

describe("T8: two people saving at the same moment", () => {
  it("lets exactly one save land and refuses the other, so neither is lost silently", async () => {
    const { call, id, mines } = await withSite();

    // Both opened the record at version 1 and press save together.
    const [a, b] = await Promise.all([
      call("PATCH", `/api/v1/mines/${id}`, {
        token: "owner-token",
        body: { location: "Kriel", version: 1, reason: REASON },
      }),
      call("PATCH", `/api/v1/mines/${id}`, {
        token: "manager-token",
        body: { location: "Ogies", version: 1, reason: REASON },
      }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? "Kriel" : "Ogies";
    expect(mines.rows[0]).toMatchObject({ location: winner, version: 2 });
  });

  it("still refuses all but one when five people save at once", async () => {
    const { call, id } = await withSite();
    const saves = ["A", "B", "C", "D", "E"].map((team) =>
      call("PATCH", `/api/v1/mines/${id}`, {
        token: "owner-token",
        body: { team_name: team, version: 1, reason: REASON },
      }),
    );
    const statuses = (await Promise.all(saves)).map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);
  });
});
