import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    tanstackStart({
      // This tells TanStack to use our custom web/src/server.ts 
      server: { entry: "server" },
    }),
    viteReact(),
  ],
});