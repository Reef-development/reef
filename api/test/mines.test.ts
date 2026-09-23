import { describe, expect, it } from "vitest";
import { testApp } from "./fakes.js";

const site = { name: "Kriel Plant 2", location: "Kriel", target_cost_per_ton: 48.5 };

describe("mines permissions", () => {
  it("lets a worker read the list", async () => {
    const res = await testApp().call("GET", "/api/v1/mines", { token: "worker-token" });
    expect(res.status).toBe(200);
  });

  it("refuses a worker who tries to add a site", async () => {
    const { call, mines } = testApp();
    const res = await call("POST", "/api/v1/mines", { token: "worker-token", body: site });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect(mines.rows).toHaveLength(0);
  });

  it("refuses a user with no current role even for reading", async () => {
    const res = await testApp().call("GET", "/api/v1/mines", { token: "legacy-token" });
    expect(res.status).toBe(403);
  });
});

describe("mines create and validate", () => {
  it("lets a manager add a site and returns it with 201", async () => {
    const res = await testApp().call("POST", "/api/v1/mines", { token: "manager-token", body: site });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ data: { name: "Kriel Plant 2", active: true } });
  });

  it("refuses a site with no name and says which field", async () => {
    const res = await testApp().call("POST", "/api/v1/mines", { token: "owner-token", body: { location: "Kriel" } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details).toContainEqual(expect.objectContaining({ path: "name" }));
  });

  it("refuses a field it does not recognise instead of dropping it", async () => {
    const res = await testApp().call("POST", "/api/v1/mines", { token: "owner-token", body: { ...site, is_admin: true } });
    expect(res.status).toBe(400);
  });

  it("refuses a negative cost-per-ton target", async () => {
    const res = await testApp().call("POST", "/api/v1/mines", {
      token: "owner-token",
      body: { ...site, target_cost_per_ton: -1 },
    });
    expect(res.status).toBe(400);
  });

  it("refuses a body that is not JSON", async () => {
    const res = await testApp().call("POST", "/api/v1/mines", { token: "owner-token", body: "{not json" });
    expect(res.status).toBe(400);
  });
});

describe("mines read, update, delete", () => {
  async function withSite() {
    const t = testApp();
    const created = await (await t.call("POST", "/api/v1/mines", { token: "owner-token", body: site })).json();
    return { ...t, id: created.data.id as string };
  }

  it("returns one site by id", async () => {
    const { call, id } = await withSite();
    const res = await call("GET", `/api/v1/mines/${id}`, { token: "worker-token" });
    expect(await res.json()).toMatchObject({ data: { id } });
  });

  it("answers 404 for a site that does not exist", async () => {
    const res = await testApp().call("GET", "/api/v1/mines/00000000-0000-4000-8000-00000000abcd", { token: "worker-token" });
    expect(res.status).toBe(404);
  });

  it("answers 400, not 404 or 500, for an id that is not a UUID", async () => {
    const res = await testApp().call("GET", "/api/v1/mines/1", { token: "worker-token" });
    expect(res.status).toBe(400);
  });

  it("updates only the fields sent", async () => {
    const { call, id } = await withSite();
    const res = await call("PATCH", `/api/v1/mines/${id}`, { token: "manager-token", body: { target_cost_per_ton: 52 } });
    expect(await res.json()).toMatchObject({ data: { name: "Kriel Plant 2", target_cost_per_ton: 52 } });
  });

  it("deletes a site, and a second delete answers 404", async () => {
    const { call, id } = await withSite();
    expect((await call("DELETE", `/api/v1/mines/${id}`, { token: "owner-token" })).status).toBe(200);
    expect((await call("DELETE", `/api/v1/mines/${id}`, { token: "owner-token" })).status).toBe(404);
  });
});

describe("mines list paging and sorting", () => {
  async function withThree() {
    const t = testApp();
    for (const name of ["Charlie", "Alpha", "Bravo"]) {
      await t.call("POST", "/api/v1/mines", { token: "owner-token", body: { name } });
    }
    return t;
  }

  it("sorts and pages, and reports the total", async () => {
    const { call } = await withThree();
    const res = await call("GET", "/api/v1/mines?sort=name&order=desc&page=1&pageSize=2", { token: "worker-token" });
    const body = await res.json();
    expect(body.data.map((m: { name: string }) => m.name)).toEqual(["Charlie", "Bravo"]);
    expect(body.meta).toEqual({ page: 1, pageSize: 2, total: 3 });
  });

  it("refuses to sort by a column that is not on the allowed list", async () => {
    const res = await testApp().call("GET", "/api/v1/mines?sort=client_id", { token: "worker-token" });
    expect(res.status).toBe(400);
  });

  it("refuses a page size above 200", async () => {
    const res = await testApp().call("GET", "/api/v1/mines?pageSize=5000", { token: "worker-token" });
    expect(res.status).toBe(400);
  });
});
