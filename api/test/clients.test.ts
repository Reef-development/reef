import { describe, expect, it } from "vitest";
import { testApp } from "./fakes.js";

const REASON = "Updated the contract after the renewal meeting";

describe("T22: clients permissions", () => {
  it("lets a manager read the list", async () => {
    const { call } = testApp();
    const res = await call("GET", "/api/v1/clients", { token: "manager-token" });
    expect(res.status).toBe(200);
  });

  it("refuses a worker reading the list", async () => {
    const { call } = testApp();
    // Clients carry contract and revenue information. Workers do not see it.
    const res = await call("GET", "/api/v1/clients", { token: "worker-token" });
    expect(res.status).toBe(403);
  });

  it("refuses a worker adding a client", async () => {
    const { call } = testApp();
    const res = await call("POST", "/api/v1/clients", {
      token: "worker-token",
      body: { name: "Kangala Coal" },
    });
    expect(res.status).toBe(403);
  });
});

describe("T22: clients create and validate", () => {
  it("lets a manager add a client and returns it with 201", async () => {
    const { call } = testApp();
    const res = await call("POST", "/api/v1/clients", {
      token: "manager-token",
      body: {
        name: "Kangala Coal",
        contact_name: "Pieter",
        contact_email: "pieter@kangala.co.za",
        active: true,
      },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toMatchObject({
      name: "Kangala Coal",
      contact_name: "Pieter",
      contact_email: "pieter@kangala.co.za",
      active: true,
      version: 1,
    });
  });

  it("refuses a client with no name", async () => {
    const { call } = testApp();
    const res = await call("POST", "/api/v1/clients", {
      token: "manager-token",
      body: { contact_name: "Pieter" },
    });
    expect(res.status).toBe(400);
  });

  it("refuses a bad contract date", async () => {
    const { call } = testApp();
    const res = await call("POST", "/api/v1/clients", {
      token: "manager-token",
      body: { name: "Kangala Coal", contract_start: "2026/01/01" },
    });
    expect(res.status).toBe(400);
  });

  it("refuses a negative contract revenue", async () => {
    const { call } = testApp();
    const res = await call("POST", "/api/v1/clients", {
      token: "manager-token",
      body: { name: "Kangala Coal", contract_revenue_monthly: -1 },
    });
    expect(res.status).toBe(400);
  });
});

describe("T22: clients update carries a reason and writes history", () => {
  it("updates a client and records the change", async () => {
    const { call, history } = testApp();
    const created = await call("POST", "/api/v1/clients", {
      token: "manager-token",
      body: { name: "Kangala Coal", contract_revenue_monthly: 500000 },
    });
    const id = (await created.json()).data.id as string;

    const res = await call("PATCH", `/api/v1/clients/${id}`, {
      token: "manager-token",
      body: { contract_revenue_monthly: 550000, version: 1, reason: REASON },
    });
    expect(res.status).toBe(200);
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0].table_name).toBe("clients");
    expect(history.rows[0].reason).toBe(REASON);
  });

  it("refuses an update with no reason", async () => {
    const { call } = testApp();
    const created = await call("POST", "/api/v1/clients", {
      token: "manager-token",
      body: { name: "Kangala Coal" },
    });
    const id = (await created.json()).data.id as string;
    const res = await call("PATCH", `/api/v1/clients/${id}`, {
      token: "manager-token",
      body: { contract_revenue_monthly: 550000, version: 1 },
    });
    expect(res.status).toBe(400);
  });
});