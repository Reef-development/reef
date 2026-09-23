import fs from "node:fs";
import path from "node:path";

const ignoredDirectories = new Set([
  "node_modules",
  ".git",
  "dist",
  ".output",
]);

const suspiciousPatterns = [
  /password\s*[:=]\s*["'`][^"'`]+["'`]/gi,
  /secret\s*[:=]\s*["'`][^"'`]+["'`]/gi,
  /api[_-]?key\s*[:=]\s*["'`][^"'`]+["'`]/gi,
];

const extensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".json",
  ".yml",
  ".yaml",
]);

function scan(directory) {
  const findings = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;

    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      findings.push(...scan(fullPath));
      continue;
    }

    if (!extensions.has(path.extname(entry.name))) continue;

    const content = fs.readFileSync(fullPath, "utf8");

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(content)) {
        findings.push(fullPath);
        break;
      }
    }
  }

  return findings;
}

const findings = scan(process.cwd());

if (findings.length > 0) {
  console.error("Potential hard-coded secrets found:");

  for (const file of findings) {
    console.error(`- ${file}`);
  }

  process.exit(1);
}

console.log("No obvious hard-coded secrets found.");