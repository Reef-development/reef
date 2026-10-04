import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

/**
 * Direct-Supabase row-level security tests.
 *
 * These tests bypass the API entirely. They sign in as two synthetic users — one at
 * plant A, one at plant B — using the raw Supabase JS client, and then assert that the
 * database itself refuses cross-plant access. That is the point: a filter that only
 * lives in the API is bypassable by any client that talks to Supabase directly, including
 * screens we have not written yet. RLS is the only place the rule cannot be skipped.
 *
 * To run these locally, set four variables in .env:
 *   RLS_USER_A_EMAIL, RLS_USER_A_PASSWORD   (a worker at plant A)
 *   RLS_USER_B_EMAIL, RLS_USER_B_PASSWORD   (a worker at plant B)
 *
 * If those are not set, the whole suite is skipped with a message, so CI does not fail
 * on missing secrets.
 */

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

assert.ok(supabaseUrl, "VITE_SUPABASE_URL is required");
assert.ok(supabaseKey, "VITE_SUPABASE_PUBLISHABLE_KEY is required");

const userA = {
  email: process.env.RLS_USER_A_EMAIL,
  password: process.env.RLS_USER_A_PASSWORD,
};
const userB = {
  email: process.env.RLS_USER_B_EMAIL,
  password: process.env.RLS_USER_B_PASSWORD,
};

const credentialsPresent = userA.email && userA.password && userB.email && userB.password;

/** Creates a fresh Supabase client. No session is persisted between calls. */
function createClientFor() {
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Signs in as one of the RLS users on a fresh client and returns it. The client's
 * Authorization header now carries that user's token, so every query below runs under
 * that user's row-level security rules.
 */
async function signInAs(user) {
  const supabase = createClientFor();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) throw new Error(`Sign-in failed for ${user.email}: ${error.message}`);
  assert.ok(data.user, `Sign-in returned no user for ${user.email}`);
  return supabase;
}

/** The suite is skipped when the four credentials are not present. */
const skip = credentialsPresent
  ? false
  : "RLS_USER_* credentials not set in the environment — set them in .env to run these tests";

test("RLS: a worker at plant A can read their own plant's stock_items", { skip }, async () => {
  const asA = await signInAs(userA);
  const { data, error } = await asA.from("stock_items").select("id, plant");
  assert.equal(error, null, `Read failed: ${error?.message ?? ""}`);
  for (const row of data ?? []) {
    assert.equal(row.plant, "A", "A saw a row that is not at plant A");
  }
});

test("RLS: a worker at plant A cannot read plant B stock_items", { skip }, async () => {
  const asA = await signInAs(userA);
  const { data, error } = await asA.from("stock_items").select("id, plant").eq("plant", "B");
  assert.ok(
    error || (data ?? []).length === 0,
    `A saw plant B stock_items rows: ${JSON.stringify(data)}`,
  );
});

test("RLS: a worker at plant A cannot read plant B stock_levels", { skip }, async () => {
  const asA = await signInAs(userA);
  const { data, error } = await asA.from("stock_levels").select("id, plant").eq("plant", "B");
  assert.ok(
    error || (data ?? []).length === 0,
    `A saw plant B stock_levels rows: ${JSON.stringify(data)}`,
  );
});

test("RLS: a worker at plant A cannot read plant B purchase_orders", { skip }, async () => {
  const asA = await signInAs(userA);
  const { data, error } = await asA.from("purchase_orders").select("id, plant").eq("plant", "B");
  assert.ok(
    error || (data ?? []).length === 0,
    `A saw plant B purchase_orders rows: ${JSON.stringify(data)}`,
  );
});

test("RLS: a worker at plant A cannot insert stock_items at plant B", { skip }, async () => {
  const asA = await signInAs(userA);
  const { error } = await asA.from("stock_items").insert({
    name: "RLS insert attempt at B",
    plant: "B",
  });
  assert.ok(error, "A was allowed to insert a plant B stock_item");
});

test("RLS: a worker at plant A cannot change their own profiles.plant", { skip }, async () => {
  const asA = await signInAs(userA);
  const { data: me } = await asA.auth.getUser();
  assert.ok(me?.user, "Could not read the signed-in user");

  const { error } = await asA.from("profiles").update({ plant: "B" }).eq("id", me.user.id);

  // The trigger profiles_protect_plant raises an exception when a non-service role tries
  // to change plant. That is the whole point of the trigger.
  assert.ok(error, "A was allowed to change their own plant from A to B");
});
