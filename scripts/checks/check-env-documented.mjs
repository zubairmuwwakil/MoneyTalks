#!/usr/bin/env node
// Fails when src/ reads a process.env variable that .env.example does not document.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const RUNTIME_PROVIDED = new Set(["NODE_ENV", "VERCEL", "VERCEL_ENV", "VERCEL_URL", "CI"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".js", ".mjs"]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (SOURCE_EXTENSIONS.has(extname(full))) out.push(full);
  }
  return out;
}

export function findUndocumentedEnvVars(srcDir, envExamplePath) {
  const referenced = new Set();
  for (const file of walk(srcDir)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) referenced.add(match[1]);
  }

  const documented = new Set(
    readFileSync(envExamplePath, "utf8")
      .split("\n")
      .map((line) => line.match(/^([A-Z0-9_]+)\s*=/)?.[1])
      .filter(Boolean),
  );

  return [...referenced]
    .filter((name) => !documented.has(name) && !RUNTIME_PROVIDED.has(name))
    .sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const missing = findUndocumentedEnvVars("src", ".env.example");
  if (missing.length > 0) {
    console.error("check-env-documented: read in src/ but absent from .env.example:");
    for (const name of missing) console.error(`  ${name}`);
    console.error("\nAdd each with an empty value and a comment saying what it is for.");
    process.exit(1);
  }
  console.log("check-env-documented: every referenced variable is documented");
}
