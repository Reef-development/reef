import { z } from "zod";
import { DEFAULT_RETENTION, type RetentionYears } from "@reef/shared";

const Env = z
  .object({
    PORT: z.coerce.number().int().positive().default(8787),
    SUPABASE_URL: z.url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    CORS_ORIGINS: z.string().default("http://localhost:8080"),
    // How long employee information is kept, in years. The rule itself is REEF's and is written
    // up in docs/privacy.md; these two settings are what the code acts on, so REEF can change
    // either period without anybody touching the code.
    RETENTION_IDENTITY_YEARS: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(DEFAULT_RETENTION.identity),
    RETENTION_RECORD_YEARS: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(DEFAULT_RETENTION.record),
  })
  .refine((e) => e.RETENTION_IDENTITY_YEARS <= e.RETENTION_RECORD_YEARS, {
    // Removing the identity number while keeping the rest of the record is the whole point of the
    // shorter period. If the number were kept longer than the record it sits in, the two rules
    // would contradict each other and the longer one would silently win.
    message: "RETENTION_IDENTITY_YEARS must not be longer than RETENTION_RECORD_YEARS",
    path: ["RETENTION_IDENTITY_YEARS"],
  });

export type Config = {
  port: number;
  supabaseUrl: string;
  supabaseKey: string;
  corsOrigins: string[];
  retention: RetentionYears;
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
    corsOrigins: e.CORS_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    retention: {
      identity: e.RETENTION_IDENTITY_YEARS,
      record: e.RETENTION_RECORD_YEARS,
    },
  };
}
