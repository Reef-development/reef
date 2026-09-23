import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

assert.ok(supabaseUrl, "VITE_SUPABASE_URL is required");
assert.ok(supabaseKey, "VITE_SUPABASE_PUBLISHABLE_KEY is required");

function createTestClient() {
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

test("real Supabase database is reachable", async () => {
  const supabase = createTestClient();

  const { error } = await supabase
    .from("purchase_orders")
    .select("id")
    .limit(1);

  assert.equal(error, null);
});

test("anonymous user cannot read protected user roles", async () => {
  const supabase = createTestClient();

  const { data, error } = await supabase
    .from("user_roles")
    .select("user_id, role")
    .limit(1);

  assert.ok(
    error || data?.length === 0,
    "Anonymous access should not expose user roles"
  );
});

test("anonymous user cannot insert a purchase order", async () => {
  const supabase = createTestClient();

  const { error } = await supabase
    .from("purchase_orders")
    .insert({
      status: "draft",
      notes: "T3 database permission test",
    });

  assert.ok(
    error,
    "Anonymous user should not be allowed to create a purchase order"
  );
});

test("anonymous user cannot insert a production log", async () => {
  const supabase = createTestClient();

  const { error } = await supabase
    .from("production_logs")
    .insert({
      quantity: 1,
    });

  assert.ok(
    error,
    "Anonymous user should not be allowed to insert production data"
  );
});