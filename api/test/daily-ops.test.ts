import { describe, expect, it } from "vitest";
import { STOCK, USERS, testApp } from "./fakes.js";

const MINE = "00000000-0000-4000-8000-0000000000aa";
const EQUIPMENT = "00000000-0000-4000-8000-0000000000bb";

describe("production logs", () => {
  it("lets a worker capture tonnage", async () => {
    const res = await testApp().call("POST", "/api/v1/production-logs", {
      token: "worker-token",
      body: { mine_id: MINE, tons_produced: 412.5, date: "2026-09-28" },
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ data: { tons_produced: 412.5, version: 1 } });
  });

  it("refuses a worker correcting an entry, because that changes cost per ton after the fact", async () => {
    const { call, production } = testApp();
    const created = await (await call("POST", "/api/v1/production-logs", { token: "worker-token", body: { mine_id: MINE, tons_produced: 100 } })).json();
    const res = await call("PATCH", `/api/v1/production-logs/${created.data.id}`, {
      token: "worker-token",
      body: { tons_produced: 900, version: 1 },
    });
    expect(res.status).toBe(403);
    expect(production.rows[0].tons_produced).toBe(100);
  });

  it("lets a manager correct an entry with the version check from T8", async () => {
    const { call } = testApp();
    const created = await (await call("POST", "/api/v1/production-logs", { token: "worker-token", body: { mine_id: MINE, tons_produced: 100 } })).json();
    const ok = await call("PATCH", `/api/v1/production-logs/${created.data.id}`, { token: "manager-token", body: { tons_produced: 110, version: 1 } });
    expect(ok.status).toBe(200);
    const stale = await call("PATCH", `/api/v1/production-logs/${created.data.id}`, { token: "manager-token", body: { tons_produced: 120, version: 1 } });
    expect(stale.status).toBe(409);
  });

  it("refuses negative tonnage, a malformed date and an unknown field", async () => {
    const { call } = testApp();
    for (const body of [
      { mine_id: MINE, tons_produced: -5 },
      { mine_id: MINE, tons_produced: 5, date: "28/09/2026" },
      { mine_id: MINE, tons_produced: 5, approved: true },
    ]) {
      expect((await call("POST", "/api/v1/production-logs", { token: "worker-token", body })).status).toBe(400);
    }
  });
});

describe("fuel slips", () => {
  const slip = { equipment_id: EQUIPMENT, litres: 120.5, cost_per_litre: 22.4 };

  it("works out the total itself and records who logged it", async () => {
    const res = await testApp().call("POST", "/api/v1/fuel-slips", { token: "worker-token", body: slip });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ data: { total_cost: 2699.2, logged_by: USERS["worker-token"].id } });
  });

  it("refuses a total sent by the client instead of trusting it", async () => {
    const res = await testApp().call("POST", "/api/v1/fuel-slips", { token: "worker-token", body: { ...slip, total_cost: 1 } });
    expect(res.status).toBe(400);
  });

  it("refuses a client claiming someone else logged it", async () => {
    const res = await testApp().call("POST", "/api/v1/fuel-slips", {
      token: "worker-token",
      body: { ...slip, logged_by: USERS["owner-token"].id },
    });
    expect(res.status).toBe(400);
  });

  it("needs either a vehicle or a typed label", async () => {
    const res = await testApp().call("POST", "/api/v1/fuel-slips", { token: "worker-token", body: { litres: 50, cost_per_litre: 22 } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.details).toContainEqual(expect.objectContaining({ path: "vehicle_label" }));
  });

  it("refuses a photo path this system never issued", async () => {
    const res = await testApp().call("POST", "/api/v1/fuel-slips", {
      token: "worker-token",
      body: { ...slip, photo_urls: ["../../etc/passwd"] },
    });
    expect(res.status).toBe(400);
  });

  it("only lets the owner delete a slip, because slips are evidence for fuel spend", async () => {
    const { call } = testApp();
    const created = await (await call("POST", "/api/v1/fuel-slips", { token: "worker-token", body: slip })).json();
    expect((await call("DELETE", `/api/v1/fuel-slips/${created.data.id}`, { token: "manager-token" })).status).toBe(403);
    expect((await call("DELETE", `/api/v1/fuel-slips/${created.data.id}`, { token: "owner-token" })).status).toBe(200);
  });
});

describe("maintenance logs and parts", () => {
  const repair = { equipment_id: EQUIPMENT, description: "Replaced drive bearing", labour_cost: 400 };

  it("logs a repair with its parts in one request and prices the parts from stock", async () => {
    const res = await testApp().call("POST", "/api/v1/maintenance-logs", {
      token: "worker-token",
      body: { ...repair, parts: [{ stock_item_id: STOCK.bearing.id, qty: 2 }] },
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ data: { parts_cost: 300, total_cost: 700 } });
  });

  it("refuses the old prototype field names instead of silently dropping them", async () => {
    const res = await testApp().call("POST", "/api/v1/maintenance-logs", {
      token: "manager-token",
      body: { equipment_id: EQUIPMENT, description: "x", labor_cost: 100, other_cost: 50 },
    });
    expect(res.status).toBe(400);
    const paths = (await res.json()).error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["labor_cost", "other_cost"]));
  });

  it("refuses a repair with no description, and a cost field the database works out itself", async () => {
    const { call } = testApp();
    expect((await call("POST", "/api/v1/maintenance-logs", { token: "worker-token", body: { equipment_id: EQUIPMENT } })).status).toBe(400);
    expect((await call("POST", "/api/v1/maintenance-logs", { token: "worker-token", body: { ...repair, total_cost: 5 } })).status).toBe(400);
  });

  it("lists, adds and removes parts, and the repair's cost follows", async () => {
    const { call } = testApp();
    const created = await (await call("POST", "/api/v1/maintenance-logs", { token: "manager-token", body: repair })).json();
    const id = created.data.id;

    const added = await call("POST", `/api/v1/maintenance-logs/${id}/parts`, {
      token: "manager-token",
      body: { stock_item_id: STOCK.bearing.id, qty: 1 },
    });
    expect(added.status).toBe(201);
    const partId = (await added.json()).data.id;

    const listed = await (await call("GET", `/api/v1/maintenance-logs/${id}/parts`, { token: "worker-token" })).json();
    expect(listed.data).toHaveLength(1);
    expect(await (await call("GET", `/api/v1/maintenance-logs/${id}`, { token: "worker-token" })).json()).toMatchObject({
      data: { parts_cost: 150, total_cost: 550 },
    });

    expect((await call("DELETE", `/api/v1/maintenance-parts/${partId}`, { token: "manager-token" })).status).toBe(200);
    expect(await (await call("GET", `/api/v1/maintenance-logs/${id}`, { token: "worker-token" })).json()).toMatchObject({
      data: { parts_cost: 0, total_cost: 400 },
    });
  });

  it("refuses a worker adding parts to a repair already logged", async () => {
    const { call } = testApp();
    const created = await (await call("POST", "/api/v1/maintenance-logs", { token: "worker-token", body: repair })).json();
    const res = await call("POST", `/api/v1/maintenance-logs/${created.data.id}/parts`, {
      token: "worker-token",
      body: { stock_item_id: STOCK.bearing.id, qty: 1 },
    });
    expect(res.status).toBe(403);
  });

  it("answers 404 for parts on a repair that does not exist", async () => {
    const res = await testApp().call("POST", "/api/v1/maintenance-logs/00000000-0000-4000-8000-00000000dead/parts", {
      token: "manager-token",
      body: { stock_item_id: STOCK.bearing.id, qty: 1 },
    });
    expect(res.status).toBe(404);
  });
});

describe("stock usage", () => {
  it("records usage for any role and returns the item's new quantity", async () => {
    const { call, usage } = testApp();
    const res = await call("POST", "/api/v1/stock-usage", { token: "worker-token", body: { stock_item_id: STOCK.bearing.id, qty: 3 } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { qty_on_hand: 7 } });
    expect(usage).toEqual([{ stock_item_id: STOCK.bearing.id, qty: 3 }]);
  });

  it("refuses a zero quantity before reaching the database", async () => {
    const { call, usage } = testApp();
    const res = await call("POST", "/api/v1/stock-usage", { token: "worker-token", body: { stock_item_id: STOCK.bearing.id, qty: 0 } });
    expect(res.status).toBe(400);
    expect(usage).toHaveLength(0);
  });

  it("answers 404 for an unknown item", async () => {
    const res = await testApp().call("POST", "/api/v1/stock-usage", {
      token: "worker-token",
      body: { stock_item_id: "00000000-0000-4000-8000-00000000dead", qty: 1 },
    });
    expect(res.status).toBe(404);
  });
});

describe("photos", () => {
  it("chooses the file name itself, inside the caller's own folder", async () => {
    const { call, photoRequests } = testApp();
    const res = await call("POST", "/api/v1/photos/upload-url", {
      token: "worker-token",
      body: { folder: "repairs", content_type: "image/jpeg" },
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.path).toMatch(new RegExp(`^repairs/${USERS["worker-token"].id}/\\d+-[0-9a-f]{8}\\.jpg$`));
    expect(photoRequests).toEqual([data.path]);
  });

  it("refuses anything that is not a JPEG, PNG or WebP image", async () => {
    const res = await testApp().call("POST", "/api/v1/photos/upload-url", {
      token: "worker-token",
      body: { folder: "repairs", content_type: "application/pdf" },
    });
    expect(res.status).toBe(400);
  });

  it("refuses to sign a path it did not issue", async () => {
    const res = await testApp().call("GET", "/api/v1/photos/view?path=../secrets.txt", { token: "worker-token" });
    expect(res.status).toBe(400);
  });

  it("answers 404 when storage says the caller may not see the photo", async () => {
    const path = `repairs/${USERS["owner-token"].id}/forbidden.jpg`;
    const res = await testApp().call("GET", `/api/v1/photos/view?path=${encodeURIComponent(path)}`, { token: "worker-token" });
    expect(res.status).toBe(404);
  });
});

describe("T22: every endpoint in this area is explained", () => {
  it("has a purpose and a refusal reason for each maintenance and daily-operations route", () => {
    const area = testApp().registry.routes.filter((r) =>
      /production-logs|fuel-slips|maintenance|stock-usage|photos/.test(r.path),
    );
    expect(area.length).toBe(21);
    for (const r of area) {
      expect(r.summary, `${r.method} ${r.path} summary`).toBeTruthy();
      expect(r.refuses, `${r.method} ${r.path} refuses`).toBeTruthy();
    }
  });
});
