/**
 * A real Postgres (PGlite, running in-process) with every migration in supabase/migrations
 * applied in order. Supabase's own `auth` and `storage` schemas are stood in for with the few
 * pieces the migrations touch, so the SQL — triggers, functions, row-level security — runs for
 * real without Docker or a network.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));

const SUPABASE_STUBS = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;

  CREATE SCHEMA auth;
  CREATE TABLE auth.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb NOT NULL DEFAULT '{}'
  );
  -- Supabase reads the signed-in user from the request's JWT; here it comes from a setting.
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

  CREATE SCHEMA storage;
  CREATE TABLE storage.objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id text,
    name text,
    owner uuid
  );
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

  GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
`;

export type Db = PGlite & {
  /** Runs `fn` as a signed-in user, the way a request carrying that user's token would. */
  as<T>(userId: string, fn: (tx: Pick<PGlite, "query" | "exec">) => Promise<T>): Promise<T>;
  /** Creates a sign-in and the role row, as registration does. Returns the user id. */
  user(role: "owner" | "manager" | "worker"): Promise<string>;
};

export async function migratedDb(): Promise<Db> {
  const pg = new PGlite();
  await pg.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await pg.exec(readFileSync(MIGRATIONS + file, "utf8"));
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }

  const db = pg as Db;
  db.as = (userId, fn) =>
    pg.transaction(async (tx) => {
      await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
      await tx.exec("SET LOCAL ROLE authenticated");
      return fn(tx);
    });
  db.user = async (role) => {
    const { rows } = await pg.query<{ id: string }>(
      "INSERT INTO auth.users (email, raw_user_meta_data) VALUES ($1, $2) RETURNING id",
      [`${role}-${Math.random().toString(36).slice(2)}@test.local`, JSON.stringify({ role })],
    );
    return rows[0].id;
  };
  return db;
}
