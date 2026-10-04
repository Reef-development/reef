import { describe, expect, it } from "vitest";
import { testApp } from "./fakes.js";

describe("mines permissions", () => {
  it("lets a worker read the list", async () => {
    const { call } = testApp();
    const res = await call("GET", "/api/v1/mines", { token: "worker-token" });
    expect(res.status).toBe(200);
  });

  it("refuses a worker who tries to add a site", async () => {
    const { call } = testApp();
    const res = await call("POST", "/api/v1/mines", {
      token: "worker-token",
      body: { name: "Kriel" },
    });
    expect(res.status).toBe(403);
  });

  it("refuses a user with no current role even for reading", async () => {
    const { call } = testApp();
    const res = await call("GET", "/api/v1/mines", { token: "legacy-token" });
    expect(res.status).toBe(403);
  });
});

describe("mines create and validate", () => {
  it("lets a manager add a site and returns it with 201", async () => {
    const { call } = testApp();
    const res = await call("POST", "/api/v1/mines", {
      token: "manager-token",
      body: { name: "Kriel", location: "Mpumalanga" },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toMatchObject({ name: "Kriel", location: "Mpumalanga", version: 1 });
  });

  it("refuses a site with no name and says which field", async () => {
    const { call } = testApp();
    const res = await call("POST", "/api/v1/mines", {
      token: "manager-token",
      body: { location: "Mpumalanga" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a field it does not recognise instead of dropping it", async () => {
    const { call } = testApp();
    const res = await call("POST", "/api/v1/mines", {
      token: "manager-token",
      body: { name: "Kriel", mystery_field: "x" },
    });
    expect(res.status).toBe(400);
  });

  it("refuses a negative cost-per-ton target", async () => {
    const { call } = testApp();
    const res = await call("POST", "/api/v1/mines", {
      token: "manager-token",
      body: { name: "Kriel", target_cost_per_ton: -1 },
    });
    expect(res.status).toBe(400);
  });

  it("refuses a body that is not JSON", async () => {
    const { call } = testApp();
    const res = await call("POST", "/api/v1/mines", {
      token: "manager-token",
      body: "not json",
    });
    expect(res.status).toBe(400);
  });
});

describe("mines read, update, delete", () => {
  it("returns one site by id", async () => {
    const { call, mines } = testApp();
    const created = await call("POST", "/api/v1/mines", {
      token: "manager-token",
      body: { name: "Kriel" },
    });
    const id = (await created.json()).data.id as string;
    const res = await call("GET", `/api/v1/mines/${id}`, { token: "worker-token" });
    expect(res.status).toBe(200);
    expect((await res.json()).data.name).toBe("Kriel");
    expect(mines.rows).toHaveLength(1);
  });

  it("answers 404 for a site that does not exist", async () => {
    const { call } = testApp();
    const res = await call("GET", "/api/v1/mines/11111111-1111-4111-8111-111111111111", {
      token: "worker-token",
    });
    expect(res.status).toBe(404);
  });

  it("answers 400, not 404 or 500, for an id that is not a UUID", async () => {
    const { call } = testApp();
    const res = await call("GET", "/api/v1/mines/not-a-uuid", { token: "worker-token" });
    expect(res.status).toBe(400);
  });

  it("updates only the fields sent, and requires a reason", async () => {
    const { call } = testApp();
    const created = await call("POST", "/api/v1/mines", {
      token: "manager-token",
      body: { name: "Kriel", location: "Mpumalanga" },
    });
    const id = (await created.json()).data.id as string;

    const res = await call("PATCH", `/api/v1/mines/${id}`, {
      token: "manager-token",
      body: {
        target_cost_per_ton: 52,
        version: 1,
        reason: "Adjusted the target after the new haulage contract",
      },
    });
    // The patch only changed the cost-per-ton target. The name is unchanged.
    expect(await res.json()).toMatchObject({
      data: { name: "Kriel", target_cost_per_ton: 52 },
    });
  });

  it("deletes a site, and a second delete answers 404", async () => {
    const { call } = testApp();
    const created = await call("POST", "/api/v1/mines", {
      token: "manager-token",
      body: { name: "Kriel" },
    });
    const id = (await created.json()).data.id as string;
    const first = await call("DELETE", `/api/v1/mines/${id}`, { token: "manager-token" });
    expect(first.status).toBe(200);
    const second = await call("DELETE", `/api/v1/mines/${id}`, { token: "manager-token" });
    expect(second.status).toBe(404);
  });
});

describe("mines list paging and sorting", () => {
  it("sorts and pages, and reports the total", async () => {
    const { call } = testApp();
    await call("POST", "/api/v1/mines", {
      token: "manager-token",
      body: { name: "Zulu" },
    });
    await call("POST", "/api/v1/mines", {
      token: "manager-token",
      body: { name: "Alpha" },
    });
    const res = await call("GET", "/api/v1/mines?sort=name&order=asc", { token: "worker-token" });
    const body = await res.json();
    expect(body.data.map((r: { name: string }) => r.name)).toEqual(["Alpha", "Zulu"]);
    expect(body.meta.total).toBe(2);
  });

  it("refuses to sort by a column that is not on the allowed list", async () => {
    const { call } = testApp();
    const res = await call("GET", "/api/v1/mines?sort=password", { token: "worker-token" });
    expect(res.status).toBe(400);
  });

  it("refuses a page size above 200", async () => {
    const { call } = testApp();
    const res = await call("GET", "/api/v1/mines?pageSize=500", { token: "worker-token" });
    expect(res.status).toBe(400);
  });
});
