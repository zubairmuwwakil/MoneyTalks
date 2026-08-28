#!/usr/bin/env node
// Agents create files constantly. Without a single-valued answer to "where does
// this go", every session invents its own layout — which is how docs/plans/ and
// docs/superpowers/plans/ came to coexist, and how scripts/ became a flat drawer
// holding two implementations of the same probe beside load-bearing cron code.
// REPO_MAP.md is that answer; this is its enforcement.
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const SCRIPT_BUCKETS = ["checks", "sync", "seeds", "generators", "ops", "archive"];
const SCRIPT_FILES_OK = ["README.md"];
const DOCS_DIRS = ["decisions", "policies", "runbooks", "superpowers", "reports", "private", "archive"];

export function findStrayFiles(root) {
  const stray = [];
  const scripts = join(root, "scripts");
  if (existsSync(scripts)) {
    for (const entry of readdirSync(scripts)) {
      const full = join(scripts, entry);
      if (statSync(full).isDirectory()) {
        if (!SCRIPT_BUCKETS.includes(entry)) stray.push(`scripts/${entry}`);
      } else if (!SCRIPT_FILES_OK.includes(entry)) {
        stray.push(`scripts/${entry}`);
      }
    }
  }
  // Only folders under docs/ are governed. Loose files there (ROADMAP.md,
  // ECOSYSTEM-NARRATIVE.md) predate the buckets and are not the sprawl this
  // check exists to catch — a new *folder* is.
  const docs = join(root, "docs");
  if (existsSync(docs)) {
    for (const entry of readdirSync(docs)) {
      if (!statSync(join(docs, entry)).isDirectory()) continue;
      if (!DOCS_DIRS.includes(entry)) stray.push(`docs/${entry}`);
    }
  }
  return stray.sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stray = findStrayFiles(".");
  if (stray.length > 0) {
    console.error("check-repo-layout: these do not have a home in REPO_MAP.md:");
    for (const s of stray) console.error(`  ${s}`);
    console.error("\nPick an existing bucket. If none fits, that is a signal to write");
    console.error("an ADR in docs/decisions/ proposing a new one — not to add it silently.");
    process.exit(1);
  }
  console.log("check-repo-layout: every artifact is in a known bucket");
}
