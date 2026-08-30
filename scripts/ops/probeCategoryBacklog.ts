/**
 * probeCategoryBacklog.ts
 *
 * Answers "how much of the uncategorized pile could a geo tier ever reach?"
 * before that tier is built.
 *
 * Only a purchase carrying wallet-captured coordinates can be resolved by a
 * place lookup: GMAIL, UPLOAD and MANUAL rows have no location and never will.
 * So the ceiling on the feature is not "uncategorized purchases" — it is
 * "uncategorized purchases with a usable fix", and the gap between those two
 * numbers is the difference between shipping a fix and shipping a
 * disappointment. This prints both, plus the accuracy distribution that
 * decides whether a tight-radius rule is viable at all.
 *
 * READ-ONLY. Aggregate counts only — no merchant strings, no coordinates, no
 * user ids in the output, because this repo is public and its reports are
 * pasted into issues.
 *
 *   npx tsx scripts/ops/probeCategoryBacklog.ts [--user <userId>]
 */

import { parseArgs } from "node:util";
import dotenv from "dotenv";

const { values } = parseArgs({
  options: { user: { type: "string" } },
});

dotenv.config({ path: ".env.local", quiet: true });

/** The states `/purchases` itself excludes, so the counts match what the owner sees. */
const LIVE_STATES = ["DECLINED", "REVERSED"] as const;

function pct(part: number, whole: number): string {
  if (whole === 0) return "n/a";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function table(rows: [string, number][], total: number): void {
  const width = Math.max(...rows.map(([label]) => label.length), 8);
  for (const [label, count] of rows) {
    console.log(`    ${label.padEnd(width)}  ${String(count).padStart(6)}  ${pct(count, total)}`);
  }
}

async function main() {
  // Dynamic import: `@/lib/prisma` throws at module scope when DATABASE_URL is
  // unset, and static imports hoist above dotenv.config().
  const { prisma } = await import("../../src/lib/prisma");

  const scope = values.user ? { userId: values.user } : {};
  const live = { ...scope, financialState: { notIn: [...LIVE_STATES] } };

  const [total, uncategorized] = await Promise.all([
    prisma.purchase.count({ where: live }),
    prisma.purchase.count({ where: { ...live, category: null } }),
  ]);

  console.log("\n=== Purchase categorization backlog ===\n");
  console.log(`  Purchases (excluding declined/reversed): ${total}`);
  console.log(`  Uncategorized:                           ${uncategorized}  ${pct(uncategorized, total)}\n`);

  if (total === 0) {
    console.log("  Nothing to measure.\n");
    return;
  }

  const bySource = await prisma.purchase.groupBy({
    by: ["source"],
    where: { ...live, category: null },
    _count: { _all: true },
  });
  console.log("  Uncategorized by source:");
  table(
    bySource.map((r) => [r.source, r._count._all] as [string, number]).sort((a, b) => b[1] - a[1]),
    uncategorized,
  );

  // The real ceiling. Deliberately NOT filtered on `source: WALLET`: a purchase
  // can be Gmail-sourced and still carry a linked wallet capture, and that row
  // is just as reachable by a place lookup as a wallet-sourced one.
  const [withCoords, withCoordsUncategorized] = await Promise.all([
    prisma.purchase.count({
      where: { ...live, walletEvents: { some: { latitude: { not: null } } } },
    }),
    prisma.purchase.count({
      where: { ...live, category: null, walletEvents: { some: { latitude: { not: null } } } },
    }),
  ]);

  console.log("\n  Reachable by a place lookup (has a wallet capture with coordinates):");
  console.log(`    of all purchases:    ${withCoords}  ${pct(withCoords, total)}`);
  console.log(
    `    of the uncategorized: ${withCoordsUncategorized}  ${pct(withCoordsUncategorized, uncategorized)}   <-- the ceiling`,
  );

  // Whether a tight-radius rule can be trusted. A +/-500m fix cannot support a
  // 50m "exactly one POI" test, so these buckets decide the gate's threshold.
  const events = await prisma.walletEvent.findMany({
    where: { ...scope, latitude: { not: null } },
    select: { locationAccuracyMeters: true },
  });
  const buckets: [string, number][] = [
    ["<= 20 m", events.filter((e) => e.locationAccuracyMeters != null && e.locationAccuracyMeters <= 20).length],
    ["<= 50 m", events.filter((e) => e.locationAccuracyMeters != null && e.locationAccuracyMeters > 20 && e.locationAccuracyMeters <= 50).length],
    ["<= 100 m", events.filter((e) => e.locationAccuracyMeters != null && e.locationAccuracyMeters > 50 && e.locationAccuracyMeters <= 100).length],
    ["> 100 m", events.filter((e) => e.locationAccuracyMeters != null && e.locationAccuracyMeters > 100).length],
    ["unreported", events.filter((e) => e.locationAccuracyMeters == null).length],
  ];
  console.log(`\n  Fix accuracy across ${events.length} located wallet events:`);
  table(buckets, events.length);

  // What is already working, so the new tier is judged against a baseline
  // rather than against zero.
  const sources = await prisma.purchase.groupBy({
    by: ["categorySource"],
    where: { ...live, category: { not: null } },
    _count: { _all: true },
  });
  const categorized = total - uncategorized;
  console.log("\n  Existing resolutions by tier:");
  table(
    sources
      .map((r) => [r.categorySource ?? "(pre-provenance)", r._count._all] as [string, number])
      .sort((a, b) => b[1] - a[1]),
    categorized,
  );
  console.log("");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("../../src/lib/prisma");
    await prisma.$disconnect();
  });
