import { describe, expect, it } from "vitest";
import { testApp } from "./fakes.js";

// The live database's seeded sites and clients use hand-written ids like these. Postgres
// accepts them; a strict RFC 4122 check does not, because the version digit is 0.
const SEEDED_SITE = "22222222-0000-0000-0000-000000000001";
const SEEDED_CLIENT = "11111111-0000-0000-0000-000000000001";

function withSeededSite() {
  const t = testApp();
  const now = new Date().toISOString();
  t.mines.rows.push({
    id: SEEDED_SITE,
    name: "Highveld North Pit",
    client_id: SEEDED_CLIENT,
    location: "Ogies",
    team_name: "Alpha Crew",
    target_cost_per_ton: 220,
    active: true,
    version: 1,
    created_at: now,
    updated_at: now,
  });
  return t;
}

describe("seeded records with hand-written ids", () => {
  it("can be read", async () => {
    const res = await withSeededSite().call("GET", `/api/v1/mines/${SEEDED_SITE}`, {
      token: "worker-token",
    });
    expect(res.status).toBe(200);
  });

  it("can be changed and deleted", async () => {
    const { call } = withSeededSite();
    const patched = await call("PATCH", `/api/v1/mines/${SEEDED_SITE}`, {
      token: "owner-token",
      body: { target_cost_per_ton: 225, version: 1 },
    });
    expect(patched.status).toBe(200);
    expect(
      (await call("DELETE", `/api/v1/mines/${SEEDED_SITE}`, { token: "owner-token" })).status,
    ).toBe(200);
  });

  it("can be referred to from a new record", async () => {
    const res = await testApp().call("POST", "/api/v1/mines", {
      token: "owner-token",
      body: { name: "Kriel Plant 2", client_id: SEEDED_CLIENT },
    });
    expect(res.status).toBe(201);
  });

  it("still refuses things that are not ids at all", async () => {
    const { call } = testApp();
    for (const bad of ["1", "not-an-id", "22222222-0000-0000-0000-00000000000Z", "' OR 1=1 --"]) {
      const res = await call("GET", `/api/v1/mines/${encodeURIComponent(bad)}`, {
        token: "worker-token",
      });
      expect(res.status, bad).toBe(400);
    }
  });
});
