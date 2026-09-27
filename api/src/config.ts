import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  CORS_ORIGINS: z.string().default("http://localhost:8080"),
});

export type Config = {
  port: number;
  supabaseUrl: string;
  supabaseKey: string;
  corsOrigins: string[];
};

/** Fails at start-up, naming every missing setting, rather than on the first request. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Missing or invalid settings in api/.env: ${names}`);
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    supabaseUrl: e.SUPABASE_URL.replace(/\/$/, ""),
    supabaseKey: e.SUPABASE_PUBLISHABLE_KEY,
    corsOrigins: e.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
  };
}
