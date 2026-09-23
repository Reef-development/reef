import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { supabaseVerifier } from "./auth/verify.js";
import { loadConfig } from "./config.js";
import { supabaseRepositories } from "./db/supabase.js";

const config = loadConfig();
const { app } = createApp({
  verifyToken: supabaseVerifier(config.supabaseUrl),
  repositories: supabaseRepositories(config),
  corsOrigins: config.corsOrigins,
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`REEF API listening on http://localhost:${info.port}`);
});
