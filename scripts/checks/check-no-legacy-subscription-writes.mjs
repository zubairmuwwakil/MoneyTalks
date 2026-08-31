#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LEGACY_WRITE = /\b(?:prisma|tx)\.subscription(?:Payment)?\.(?:create|createMany|update|updateMany|upsert)\s*\(/;
const LEGACY_READ = /\b(?:prisma|tx)\.subscription(?:Payment)?\.(?:findMany|findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|count|aggregate|groupBy)\s*\(/;
const LOSSY_PROJECTION = /\blegacySubscriptionProjection\b/;
const LEGACY_ENDPOINT = /["'`]\/api\/subscriptions(?:[/?"'`]|\$\{)/;

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

export function findLegacySubscriptionReads(root = "src") {
  return files(root)
    .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
    // Export deliberately includes frozen rollback material. It is not a live
    // product reader; account deletion likewise retains its legacy deletes.
    .filter((file) => !file.endsWith("src/app/api/data/export/route.ts"))
    .filter((file) => LEGACY_READ.test(readFileSync(file, "utf8")));
}

export function findLossyProjectionConsumers(root = "src") {
  return files(root)
    .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
    .filter((file) => !file.includes("src/app/api/subscriptions/"))
    .filter((file) => !file.endsWith("src/lib/domain/recurring/readModel.ts"))
    .filter((file) => LOSSY_PROJECTION.test(readFileSync(file, "utf8")));
}

export function findLegacySubscriptionEndpointConsumers(root = "src") {
  return files(root)
    .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
    .filter((file) => !file.includes("src/app/api/subscriptions/"))
    .filter((file) => LEGACY_ENDPOINT.test(readFileSync(file, "utf8")));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hits = findLegacySubscriptionWrites();
  const reads = findLegacySubscriptionReads();
  const lossyConsumers = findLossyProjectionConsumers();
  const endpointConsumers = findLegacySubscriptionEndpointConsumers();
  if (hits.length || reads.length || lossyConsumers.length || endpointConsumers.length) {
    console.error("check-no-legacy-subscription-writes: Subscription is rollback material; canonical code must use RecurringObligation.");
    for (const hit of [...hits, ...reads, ...lossyConsumers, ...endpointConsumers]) console.error(`  ${hit}`);
    process.exit(1);
  }
  console.log("check-no-legacy-subscription-writes: no live legacy writes, reads, endpoints, or lossy internal projections");
}
