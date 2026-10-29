import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, type Db } from "./harness.js";

// T12's read policies on user_sessions, against a real Postgres. A fake cannot prove that a
// policy hides or shows a row.

let db: Db;
let owner: string;
let worker: string;
let manager: string;

beforeAll(async () => {
  db = await migratedDb();
  owner = await db.user("owner");
  worker = await db.user("worker");
  manager = await db.user("manager");
  for (const user of [owner, worker, manager]) {
    await db.query(
      "INSERT INTO user_sessions (user_id, session_id, device) VALUES ($1, gen_random_uuid(), 'Chrome')",
      [user],
    );
  }
}, 60_000);

const visibleTo = async (userId: string) =>
  (
    await db.as(userId, (tx) => tx.query<{ user_id: string }>("SELECT user_id FROM user_sessions"))
  ).rows.map((r) => r.user_id);

describe("T12: who can see which sign-ins", () => {
  it("a worker sees their own sign-in, and nobody else's", async () => {
    expect(await visibleTo(worker)).toEqual([worker]);
  });

  it("a manager sees their own sign-in, and nobody else's", async () => {
    expect(await visibleTo(manager)).toEqual([manager]);
  });

  it("the owner sees everyone's", async () => {
    expect((await visibleTo(owner)).sort()).toEqual([owner, worker, manager].sort());
  });
});
