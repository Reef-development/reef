import { defineConfig } from "vitest/config";

// Own config so vitest does not pick up the prototype's vite.config.ts at the repo root.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
