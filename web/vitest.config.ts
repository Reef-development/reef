import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Vitest config for the web app.
 *
 * Standalone — it does not extend vite.config.ts. The Lovable wrapper there pulls in
 * TanStack Start, the SSR entry, and Nitro's build-time plugins, none of which belong
 * in a test run.
 *
 * The include pattern covers two sets of tests:
 *   src/**\/*.test.tsx   screen behaviour tests (T19)
 *   test/**\/*.test.ts   pure-logic tests (T9's number check)
 */
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.ts"],
    css: false,
  },
});