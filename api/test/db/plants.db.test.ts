import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, type Db } from "./harness.js";

// The plants migration is the only one in this project that will meet a database with rows
// already in it: every plant value currently in use has to become a row before the keys are
// added, or applying it would refuse data that is already there. An empty database cannot show
// that, so this test puts the rows in first, the way the live one has them, and then applies it.

const PLANTS_MIGRATION = "20261005090000_plants.sql";
const SQL = fileURLToPath(
  new URL(`../../../supabase/migrations/${PLANTS_MIGRATION}`, import.meta.url),
);

let db: Db;

beforeAll(async () => {
  db = await migratedDb(PLANTS_MIGRATION);

  // Plants A and B, in use across three tables, exactly as T14 left them.
  await db.query("INSERT INTO stock_items (name, plant) VALUES ('Bearing', 'A'), ('Belt', 'B')");
  await db.query("INSERT INTO purchase_orders (status, plant) VALUES ('ordered', 'A')");
  // T14 locks profiles.plant with a trigger that refuses every writer, which is a good rule and
  // not one to work around in the product. It is turned off for this one seeding statement
  // because the live database already has these values set, by whoever set them before that
  // trigger existed, and reproducing that state is the whole point of this test.
  await db.user("manager");
  await db.exec("ALTER TABLE public.profiles DISABLE TRIGGER profiles_protect_plant_trigger");
  await db.query("UPDATE profiles SET plant = 'B' WHERE id = (SELECT id FROM profiles LIMIT 1)");
  await db.exec("ALTER TABLE public.profiles ENABLE TRIGGER profiles_protect_plant_trigger");

  await db.exec(readFileSync(SQL, "utf8"));
}, 60_000);

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0];

describe("applying the plants migration to a database that already has data", () => {
  it("applies at all, which is the thing an empty database cannot show", async () => {
    const { count } = await one<{ count: string }>("SELECT count(*)::text AS count FROM plants");
    expect(Number(count)).toBeGreaterThan(0);
  });

  it("brings every plant already in use with it, from all three tables", async () => {
    const { rows } = await db.query<{ name: string }>("SELECT name FROM plants ORDER BY name");
    expect(rows.map((r) => r.name)).toEqual(["A", "B"]);
  });

  it("loses no rows", async () => {
    const stock = await one<{ count: string }>("SELECT count(*)::text AS count FROM stock_items");
    const orders = await one<{ count: string }>(
      "SELECT count(*)::text AS count FROM purchase_orders",
    );
    expect(stock.count).toBe("2");
    expect(orders.count).toBe("1");
  });

  it("refuses a new plant nobody has heard of, from that point on", async () => {
    await expect(
      db.query("INSERT INTO stock_items (name, plant) VALUES ('Liner', 'Mokopane 1')"),
    ).rejects.toThrow(/foreign key|plants/i);
  });

  it("leaves every existing row able to be updated, so nothing is stranded", async () => {
    await expect(
      db.query("UPDATE stock_items SET unit_cost = 5 WHERE plant = 'A'"),
    ).resolves.toBeDefined();
  });
});
