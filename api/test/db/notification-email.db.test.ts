import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, type Db } from "./harness.js";

// T17 against a real Postgres: what the sweep is given to email, and who may ask for it.

let db: Db;
let owner: string;

beforeAll(async () => {
  db = await migratedDb();
  owner = await db.user("owner");
}, 60_000);

async function notify(key: string, createdAgo = "0 days") {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO notifications (user_id, kind, subject, body, dedupe_key, created_at)
     VALUES ($1, 'service_due', 'Pump due', 'The pump is due a service.', $2, now() - $3::interval)
     RETURNING id`,
    [owner, key, createdAgo],
  );
  return rows[0].id;
}

const toEmail = async () =>
  (
    await db.query<{ id: string; email: string; subject: string }>(
      "SELECT * FROM notifications_to_email()",
    )
  ).rows;

describe("T17: notifications waiting to be emailed", () => {
  it("lists one that has not gone out, with the address of the person it is for", async () => {
    const id = await notify("a");
    const email = (
      await db.query<{ email: string }>("SELECT email FROM auth.users WHERE id = $1", [owner])
    ).rows[0].email;
    expect(await toEmail()).toContainEqual(
      expect.objectContaining({ id, email, subject: "Pump due" }),
    );
  });

  it("leaves out one that was emailed, so it is never sent twice", async () => {
    const id = await notify("b");
    await db.query("UPDATE notifications SET emailed_at = now() WHERE id = $1", [id]);
    expect((await toEmail()).map((r) => r.id)).not.toContain(id);
  });

  it("keeps one whose email failed, with the reason, so a later sweep tries again", async () => {
    const id = await notify("c");
    await db.query(
      "UPDATE notifications SET email_failed_at = now(), email_error = '550 Mailbox unavailable' WHERE id = $1",
      [id],
    );
    expect((await toEmail()).map((r) => r.id)).toContain(id);
  });

  it("stops trying after a week", async () => {
    const id = await notify("d", "8 days");
    expect((await toEmail()).map((r) => r.id)).not.toContain(id);
  });

  it("is not open to signed-in users, since it lists other people's addresses", async () => {
    await expect(
      db.as(owner, (tx) => tx.query("SELECT * FROM notifications_to_email()")),
    ).rejects.toThrow(/permission denied/);
  });
});
