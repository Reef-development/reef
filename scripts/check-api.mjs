import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const apiDirectory = path.resolve("src/routes/api");

assert.ok(
  fs.existsSync(apiDirectory),
  "src/routes/api directory does not exist"
);

const files = fs
  .readdirSync(apiDirectory, { recursive: true })
  .filter((file) => String(file).endsWith(".ts") || String(file).endsWith(".tsx"));

assert.ok(files.length > 0, "No API route files were found");

console.log("API route files found:");

for (const file of files) {
  console.log(`- ${file}`);
}

console.log(`Total API route files: ${files.length}`);