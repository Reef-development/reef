import { describe, expect, it } from "vitest";
import { testApp } from "./fakes.js";

const REASON = "Added the vendor after the new haulage contract";

describe("T22: suppliers permissions", () => {
  it("lets a manager read the list", async () => {
    const { call } = testApp();
    const res = await call("GET", "/api/v1/suppliers", { token: "manager-token" });
    expect(res.status).toBe(200);
  });

  it("refuses a worker reading the list", async () => {
    const { call } = testApp();
    // Workers do not see the vendors REEF buys from. Suppliers carry cost and contract
    // information that is a management concern.
    const res = await call("GET", "/api/v1/suppliers", { token: "worker-token" });
    expect(res.status).toBe(403);
  });

  it("refuses a worker adding a supplier", async () => {
    const { call } = testApp();
    const res = await call("POST", "/api/v1/suppliers", {
      token: "worker-token",
      body: { name: "Highveld Steel" },
    });
    expect(res.status).toBe(403);
  });
});

describe("T22: suppliers create and validate", () => {
  it("lets a manager add a supplier and returns it with 201", async () => {
    const { call } = testApp();
    const res = await call("POST", "/api/v1/suppliers", {
      token: "manager-token",
      body: { name: "Highveld Steel", contact_name: "Riaan", email: "sales@highveld.co.za" },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toMatchObject({
      name: "Highveld Steel",
      contact_name: "Riaan",
      email: "sales@highveld.co.za",
      version: 1,
    });
  });

  it("refuses a supplier with no name", async () => {
    const { call } = testApp();
    const res = await call("POST", "/api/v1/suppliers", {
      token: "manager-token",
      body: { contact_name: "Riaan" },
    });
    expect(res.status).toBe(400);
  });

  it("refuses a supplier with a bad email", async () => {
    const { call } = testApp();
    const res = await call("POST", "/api/v1/suppliers", {
      token: "manager-token",
      body: { name: "Highveld Steel", email: "not an email" },
    });
    expect(res.status).toBe(400);
  });

  it("refuses a field it does not recognise", async () => {
    const { call } = testApp();
    const res = await call("POST", "/api/v1/suppliers", {
      token: "manager-token",
      body: { name: "Highveld Steel", mystery_field: "x" },
    });
    expect(res.status).toBe(400);
  });
});

describe("T22: suppliers update carries a reason and writes history", () => {
  it("updates a supplier and records the change", async () => {
    const { call, history } = testApp();
    const created = await call("POST", "/api/v1/suppliers", {
      token: "manager-token",
      body: { name: "Highveld Steel", email: "old@highveld.co.za" },
    });
    const id = (await created.json()).data.id as string;

    const res = await call("PATCH", `/api/v1/suppliers/${id}`, {
      token: "manager-token",
      body: { email: "new@highveld.co.za", version: 1, reason: REASON },
    });
    expect(res.status).toBe(200);
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0].table_name).toBe("suppliers");
    expect(history.rows[0].reason).toBe(REASON);
  });

  it("refuses an update with no reason", async () => {
    const { call } = testApp();
    const created = await call("POST", "/api/v1/suppliers", {
      token: "manager-token",
      body: { name: "Highveld Steel" },
    });
    const id = (await created.json()).data.id as string;
    const res = await call("PATCH", `/api/v1/suppliers/${id}`, {
      token: "manager-token",
      body: { email: "new@highveld.co.za", version: 1 },
    });
    expect(res.status).toBe(400);
  });
});