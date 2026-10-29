import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { supabaseVerifier } from "./auth/verify.js";
import { loadConfig } from "./config.js";
import { schedulerRepositories, supabaseRepositories } from "./db/supabase.js";
import { startScheduler } from "./services/scheduler.js";

const config = loadConfig();
const { app } = createApp({
  verifyToken: supabaseVerifier(config.supabaseUrl),
  repositories: supabaseRepositories(config),
  corsOrigins: config.corsOrigins,
  retention: config.retention,
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`REEF API listening on http://localhost:${info.port}`);
});

// Started after the server is listening, so a slow first sweep cannot delay the health check
// the deploy is waiting on.
const scheduled = schedulerRepositories(config);
const stopScheduler = scheduled
  ? startScheduler({
      jobs: scheduled.jobs,
      sweepRepo: scheduled.sweepRepo,
      zone: config.timezone,
      log: (message) => console.log(message),
    })
  : null;

if (!scheduled) {
  // Said plainly rather than left silent. Nobody notices reminders that were never going to be
  // sent, which is the whole reason this task exists.
  console.warn(
    "SUPABASE_SERVICE_ROLE_KEY is not set, so the service reminder sweep is NOT running. " +
      "Every day it does not run shows as missed on GET /api/v1/admin/jobs.",
  );
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopScheduler?.();
    server.close(() => process.exit(0));
  });
}
