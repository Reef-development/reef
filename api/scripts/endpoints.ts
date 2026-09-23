/**
 * Writes docs/api-endpoints.md from the running route registry. With --check it writes nothing
 * and fails if the file differs, which is how the pipeline catches a list that has drifted from
 * the code. Edit the route definitions, never this file's output.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PERMISSIONS } from "@reef/shared";
import { createApp } from "../src/app.js";
import type { RouteInfo } from "../src/registry.js";

const OUT = fileURLToPath(new URL("../../docs/api-endpoints.md", import.meta.url));
const NEEDS = "_Needs explanation_";

function who(access: RouteInfo["access"]): string {
  if (access === "public") return "Anyone";
  if (access === "signed-in") return "Any signed-in user";
  return PERMISSIONS[access].join(", ");
}

export function render(routes: RouteInfo[]): string {
  const explained = routes.filter((r) => r.summary).length;
  const lines = [
    "# REEF API endpoints",
    "",
    "Generated from the route registry by `npm run endpoints` in `api/`. Do not edit by hand.",
    "",
    `${routes.length} endpoints, ${explained} explained.`,
    "",
    "| Method | Path | Who may call it | What it is for | What it refuses |",
    "|---|---|---|---|---|",
    ...routes.map(
      (r) => `| ${r.method} | \`${r.path}\` | ${who(r.access)} | ${r.summary ?? NEEDS} | ${r.refuses ?? "-"} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

const unused = () => {
  throw new Error("not used when listing routes");
};
const { registry } = createApp({ verifyToken: unused, repositories: unused, corsOrigins: [] });
const text = render(registry.routes);

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8").replace(/\r\n/g, "\n");
  } catch {
    // missing file counts as drift
  }
  if (current !== text) {
    console.error("docs/api-endpoints.md is out of date. Run `npm run endpoints` in api/ and commit the result.");
    process.exit(1);
  }
  console.log(`Endpoint list matches the code (${registry.routes.length} endpoints).`);
} else {
  writeFileSync(OUT, text);
  console.log(`Wrote ${registry.routes.length} endpoints to docs/api-endpoints.md`);
}
