import { describe, expect, it } from "vitest";
import { testApp, USERS } from "./fakes.js";

describe("health", () => {
  it("answers ok without signing in", async () => {
    const { call } = testApp();
    const res = await call("GET", "/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { status: "ok" } });
  });
});

describe("signing in", () => {
  it("refuses a request with no token, in the failure envelope", async () => {
    const res = await testApp().call("GET", "/api/v1/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  });

  it("refuses a token it cannot verify", async () => {
    const res = await testApp().call("GET", "/api/v1/me", {
      token: "forged",
    });
    expect(res.status).toBe(401);
  });

  it("returns the caller's id and highest role", async () => {
    const res = await testApp().call("GET", "/api/v1/me", {
      token: "manager-token",
    });

    expect(res.status).toBe(200);

    expect(await res.json()).toEqual({
      data: { id: "00000000-0000-4000-8000-000000000002", role: "manager", plant: "A" },
    });
  });

  it("treats a user holding only a retired role as having no role", async () => {
    const res = await testApp().call("GET", "/api/v1/me", {
      token: "legacy-token",
    });

    expect(await res.json()).toMatchObject({
      data: { role: null },
    });
  });
});

describe("active sign-ins", () => {
  it("lets a person see their own active sign-ins", async () => {
    const { call } = testApp();

    await call("GET", "/api/v1/me", {
      token: "worker-token",
    });

    const res = await call("GET", "/api/v1/sessions", {
      token: "worker-token",
    });

    expect(res.status).toBe(200);

    expect(await res.json()).toMatchObject({
      data: [
        {
          user_id: USERS["worker-token"].id,
          session_id: USERS["worker-token"].sessionId,
          revoked_at: null,
        },
      ],
    });
  });

  it("lets an owner view another user's active sign-ins", async () => {
    const { call } = testApp();

    await call("GET", "/api/v1/me", {
      token: "worker-token",
    });

    const workerId = USERS["worker-token"].id;

    const res = await call("GET", `/api/v1/users/${workerId}/sessions`, {
      token: "owner-token",
    });

    expect(res.status).toBe(200);

    expect(await res.json()).toMatchObject({
      data: [
        {
          user_id: workerId,
          session_id: USERS["worker-token"].sessionId,
          revoked_at: null,
        },
      ],
    });
  });

  it("refuses a non-owner trying to manage another user's sign-ins", async () => {
    const workerId = USERS["worker-token"].id;

    const res = await testApp().call("GET", `/api/v1/users/${workerId}/sessions`, {
      token: "manager-token",
    });

    expect(res.status).toBe(403);
  });

  it("refuses a revoked sign-in on its very next request", async () => {
    const { call } = testApp();

    await call("GET", "/api/v1/me", {
      token: "worker-token",
    });

    const sessionId = USERS["worker-token"].sessionId;

    const revoke = await call("DELETE", `/api/v1/sessions/${sessionId}`, {
      token: "owner-token",
    });

    expect(revoke.status).toBe(200);

    const nextRequest = await call("GET", "/api/v1/me", {
      token: "worker-token",
    });

    expect(nextRequest.status).toBe(401);

    expect(await nextRequest.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  });

  it("lets an owner revoke all active sign-ins for a user", async () => {
    const { call } = testApp();

    await call("GET", "/api/v1/me", {
      token: "worker-token",
    });

    const workerId = USERS["worker-token"].id;

    const revoke = await call("DELETE", `/api/v1/users/${workerId}/sessions`, {
      token: "owner-token",
    });

    expect(revoke.status).toBe(200);

    expect(await revoke.json()).toEqual({
      data: {
        userId: workerId,
        revokedCount: 1,
      },
    });

    const nextRequest = await call("GET", "/api/v1/me", {
      token: "worker-token",
    });

    expect(nextRequest.status).toBe(401);
  });
});

describe("errors", () => {
  it("answers an unknown path with 404 in the envelope", async () => {
    const res = await testApp().call("GET", "/api/v1/nothing-here");
    expect(res.status).toBe(404);

    expect(await res.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  it("hides the cause of an unexpected failure from the caller but logs it", async () => {
    const boom = {
      list: async () => Promise.reject(new Error("connection string leaked here")),
    };

    const { call, logged } = testApp({
      mines: boom as never,
    });

    const res = await call("GET", "/api/v1/mines", {
      token: "worker-token",
    });

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("connection string");
    expect(logged).toHaveLength(1);
  });

  it("sets security headers on every response", async () => {
    const res = await testApp().call("GET", "/health");

    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("route registry", () => {
  it("lists every route with an access rule", () => {
    const { registry } = testApp();

    expect(registry.routes.length).toBeGreaterThan(0);

    for (const r of registry.routes) {
      expect(r.access).toBeTruthy();
    }
  });

  it("only leaves health open without signing in", () => {
    const open = testApp()
      .registry.routes.filter((r) => r.access === "public")
      .map((r) => r.path);

    expect(open).toEqual(["/health"]);
  });
});
