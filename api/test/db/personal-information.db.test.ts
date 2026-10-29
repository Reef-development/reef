import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, type Db } from "./harness.js";

let db: Db;
let owner: string;
let manager: string;
let worker: string;
let krielEmployee: string;
let ogiesEmployee: string;

beforeAll(async () => {
  db = await migratedDb();

  owner = await db.user("owner");
  manager = await db.user("manager");
  worker = await db.user("worker");

  await db.query("INSERT INTO plants (name) VALUES ('Kriel'), ('Ogies') ON CONFLICT DO NOTHING");

  await db.transaction(async (tx) => {
    await tx.query("SELECT set_config('request.jwt.claim.role', 'service_role', true)");
    await tx.query("UPDATE profiles SET plant = 'Kriel' WHERE id = ANY($1)", [[manager, worker]]);
  });

  const krielMine = await db.query<{ id: string }>(
    "INSERT INTO mines (name, plant) VALUES ('Kriel Mine', 'Kriel') RETURNING id",
  );

  const ogiesMine = await db.query<{ id: string }>(
    "INSERT INTO mines (name, plant) VALUES ('Ogies Mine', 'Ogies') RETURNING id",
  );

  const kriel = await db.query<{ id: string }>(
    "INSERT INTO employees (full_name, mine_id) VALUES ('Kriel Employee', $1) RETURNING id",
    [krielMine.rows[0].id],
  );

  const ogies = await db.query<{ id: string }>(
    "INSERT INTO employees (full_name, mine_id) VALUES ('Ogies Employee', $1) RETURNING id",
    [ogiesMine.rows[0].id],
  );

  krielEmployee = kriel.rows[0].id;
  ogiesEmployee = ogies.rows[0].id;

  await db.query(
    `INSERT INTO employee_personal_information (employee_id, id_number)
     VALUES ($1, '1111111111111'), ($2, '2222222222222')`,
    [krielEmployee, ogiesEmployee],
  );
}, 60_000);

async function disclose(userId: string, employeeId: string) {
  const result = await db.as(userId, (tx) =>
    tx.query<{ id_number: string | null }>(
      "SELECT public.disclose_personal_information($1) AS id_number",
      [employeeId],
    ),
  );

  return result.rows[0].id_number;
}

describe("T11: protected employee personal information", () => {
  it("allows the owner to disclose identity numbers from any plant", async () => {
    expect(await disclose(owner, krielEmployee)).toBe("1111111111111");
    expect(await disclose(owner, ogiesEmployee)).toBe("2222222222222");
  });

  it("allows a manager to disclose identity numbers from their own plant", async () => {
    expect(await disclose(manager, krielEmployee)).toBe("1111111111111");
  });

  it("refuses a manager access to identity numbers from another plant", async () => {
    expect(await disclose(manager, ogiesEmployee)).toBeNull();
  });

  it("refuses a worker access to identity numbers", async () => {
    expect(await disclose(worker, krielEmployee)).toBeNull();
  });
});

describe("T11: updating protected employee personal information", () => {
  it("refuses a manager changing an identity number for another plant", async () => {
    await expect(
      db.as(manager, (tx) =>
        tx.query("SELECT public.set_employee_id_number($1, '9999999999999')", [ogiesEmployee]),
      ),
    ).rejects.toThrow();
  });
});
