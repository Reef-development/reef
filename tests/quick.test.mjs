import test from "node:test";
import assert from "node:assert/strict";

function calculateFuelCost(litres, costPerLitre) {
  return Number((litres * costPerLitre).toFixed(2));
}

function canAccessManagement(role) {
  return role === "owner" || role === "manager";
}

function canAccessWorkerCapture(role) {
  return role === "owner" || role === "manager" || role === "worker";
}

function canApprovePurchaseOrder(role) {
  return role === "owner" || role === "manager";
}

test("fuel cost is calculated correctly", () => {
  const result = calculateFuelCost(100, 25);

  assert.equal(result, 2500);
});

test("fuel cost handles decimal litres", () => {
  const result = calculateFuelCost(12.5, 24.75);

  assert.equal(result, 309.38);
});

test("owner can access management functions", () => {
  assert.equal(canAccessManagement("owner"), true);
});

test("manager can access management functions", () => {
  assert.equal(canAccessManagement("manager"), true);
});

test("worker cannot access management functions", () => {
  assert.equal(canAccessManagement("worker"), false);
});

test("worker can access worker capture", () => {
  assert.equal(canAccessWorkerCapture("worker"), true);
});

test("manager can approve a purchase order", () => {
  assert.equal(canApprovePurchaseOrder("manager"), true);
});

test("worker cannot approve a purchase order", () => {
  assert.equal(canApprovePurchaseOrder("worker"), false);
});  