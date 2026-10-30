import { fileURLToPath } from "node:url";
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
 *   test/**\/*.test.tsx  screen tests that render whole pages (T18, T20)
 */
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  // tsconfigPaths only maps @/ for files tsconfig includes, and test/ is outside it.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
    // Screen tests load real pages (charts included); the first one pays the cold start.
    testTimeout: 30_000,
    css: false,
  },
});
