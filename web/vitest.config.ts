import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Vitest config for the web app.
 *
 * Standalone — it does not extend vite.config.ts. The Lovable wrapper there pulls in
 * TanStack Start, the SSR entry, and Nitro's build-time plugins, none of which belong
 * in a test run. This config gives vitest only what it needs: React JSX, the @/ path
 * alias, jsdom as the DOM, and a setup file that loads the jest-dom matchers.
 */
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});