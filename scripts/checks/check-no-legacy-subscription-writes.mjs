#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LEGACY_WRITE = /\b(?:prisma|tx)\.subscription(?:Payment)?\.(?:create|createMany|update|updateMany|upsert)\s*\(/;

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [full] : [];
  });
}

export function findLegacySubscriptionWrites(root = "src") {
  return files(root)
    .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
    .filter((file) => LEGACY_WRITE.test(readFileSync(file, "utf8")));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hits = findLegacySubscriptionWrites();
  if (hits.length) {
    console.error("check-no-legacy-subscription-writes: Subscription is rollback material, never a live write target.");
    for (const hit of hits) console.error(`  ${hit}`);
    process.exit(1);
  }
  console.log("check-no-legacy-subscription-writes: no live legacy subscription writes");
}
