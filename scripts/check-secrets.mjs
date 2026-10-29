import fs from "node:fs";
import path from "node:path";

const ignoredDirectories = new Set([
  "node_modules",
  ".git",
  "dist",
  ".output",
]);

// Put this in a comment on a line that is a known, agreed exception. Only that line is
// skipped; the rest of the file is still checked.
const ALLOW_MARKER = "secrets-check: allow";

const suspiciousPatterns = [
  /password\s*[:=]\s*["'`][^"'`]+["'`]/i,
  /secret\s*[:=]\s*["'`][^"'`]+["'`]/i,
  /api[_-]?key\s*[:=]\s*["'`][^"'`]+["'`]/i,
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

    // Checked line by line, so one allowlisted line cannot hide a real secret elsewhere in
    // the same file, and each finding names its line.
    const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/);

    lines.forEach((line, index) => {
      if (line.includes(ALLOW_MARKER)) return;
      if (suspiciousPatterns.some((pattern) => pattern.test(line))) {
        findings.push(`${fullPath}:${index + 1}`);
      }
    });
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
