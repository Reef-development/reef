import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

/**
 * Direct-Supabase tests for the T6 history trigger.
 *
 * The API's update path calls a stored procedure (update_<table>), which sets the reason
 * on the database session. A trigger reads that reason and writes the history row inside
 * the same transaction. If the reason is missing, the trigger raises and the update rolls
 * back.
 *
 * These tests prove that behaviour against real Postgres — not against the in-memory
 * fakes, which do not run triggers. A review by Tayler found the previous version of T6
 * passed all 44 unit tests while failing against a real database, so the point of this
 * file is to close that gap.
 *
 * Signs in as the owner because the current read policy on the history table filters
 * managers by plant, and mines have no plant. The trigger fires identically for any
 * caller; the owner reads every history row without that filter.
 *
 * To run locally, .env must have:
 *   VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY   (already present)
 *   RLS_OWNER_EMAIL, RLS_OWNER_PASSWORD                (the owner test user)
 *
 * If the credentials are missing, the whole suite is skipped.
 */

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

assert.ok(supabaseUrl, "VITE_SUPABASE_URL is required");
assert.ok(supabaseKey, "VITE_SUPABASE_PUBLISHABLE_KEY is required");

const owner = {
  email: process.env.RLS_OWNER_EMAIL,
  password: process.env.RLS_OWNER_PASSWORD,
};

const credentialsPresent = Boolean(owner.email && owner.password);

const skip = credentialsPresent
  ? false
  : "RLS_OWNER_* credentials not set in the environment — set them in .env to run these tests";

function createClientFor() {
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signInAs(user) {
  const supabase = createClientFor();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) throw new Error(`Sign-in failed for ${user.email}: ${error.message}`);
  assert.ok(data.user, `Sign-in returned no user for ${user.email}`);
  return { supabase, userId: data.user.id };
}

async function createMine(supabase, name) {
  const { data, error } = await supabase
    .from("mines")
    .insert({ name, active: true })
    .select()
    .single();
  assert.equal(error, null, `Could not create a test mine: ${error?.message ?? ""}`);
  return data;
}

async function deleteMine(supabase, id) {
  await supabase.from("mines").delete().eq("id", id);
}

test("T6 (direct): update_mines without a reason is refused by the trigger", { skip }, async () => {
  const { supabase } = await signInAs(owner);
  const mine = await createMine(supabase, "Trigger refusal test");

  try {
    const { error } = await supabase.rpc("update_mines", {
      p_id: mine.id,
      p_patch: { name: "Should not be applied" },
      p_expected_version: mine.version,
      p_reason: "",
    });

    assert.ok(error, "The update went through without a reason");
    assert.match(error.message, /reason is required/i);

    const { data: after } = await supabase.from("mines").select("*").eq("id", mine.id).single();
    assert.equal(after.name, "Trigger refusal test");
    assert.equal(after.version, mine.version);
  } finally {
    await deleteMine(supabase, mine.id);
  }
});

test("T6 (direct): update_mines with a reason writes one history row", { skip }, async () => {
  const { supabase, userId } = await signInAs(owner);
  const mine = await createMine(supabase, "Trigger success test");
  const reason = "T6 direct test: renaming the mine";

  try {
    const { data, error } = await supabase.rpc("update_mines", {
      p_id: mine.id,
      p_patch: { name: "Renamed by the test" },
      p_expected_version: mine.version,
      p_reason: reason,
    });

    assert.equal(error, null, `Update failed: ${error?.message ?? ""}`);
    assert.ok(Array.isArray(data), "The RPC should return a setof rows");
    assert.equal(data.length, 1, "The RPC should return exactly one row");
    const updated = data[0];
    assert.equal(updated.name, "Renamed by the test");
    assert.equal(updated.version, mine.version + 1);

    const { data: history, error: historyError } = await supabase
      .from("history")
      .select("*")
      .eq("table_name", "mines")
      .eq("row_id", mine.id)
      .order("changed_at", { ascending: false })
      .limit(1);

    assert.equal(historyError, null, `History read failed: ${historyError?.message ?? ""}`);
    assert.ok(history && history.length === 1, "No history row was written");
    const entry = history[0];
    assert.equal(entry.changed_by, userId);
    assert.equal(entry.reason, reason);
    assert.equal(entry.version, mine.version + 1);
    assert.equal(entry.new_values.name, "Renamed by the test");
  } finally {
    await deleteMine(supabase, mine.id);
  }
});

test("T6 (direct): a stale version is refused by the RPC", { skip }, async () => {
  const { supabase } = await signInAs(owner);
  const mine = await createMine(supabase, "Stale version test");

  try {
    const { error: firstError } = await supabase.rpc("update_mines", {
      p_id: mine.id,
      p_patch: { name: "First rename" },
      p_expected_version: mine.version,
      p_reason: "First rename",
    });
    assert.equal(firstError, null);

    const { data, error } = await supabase.rpc("update_mines", {
      p_id: mine.id,
      p_patch: { name: "Second rename" },
      p_expected_version: mine.version,
      p_reason: "Second rename",
    });
    assert.equal(error, null);
    assert.ok(Array.isArray(data) && data.length === 0, "The stale update should return no rows");

    const { data: history } = await supabase
      .from("history")
      .select("id")
      .eq("table_name", "mines")
      .eq("row_id", mine.id);
    assert.equal(history.length, 1, "A stale update wrote a history row");
  } finally {
    await deleteMine(supabase, mine.id);
  }
});
