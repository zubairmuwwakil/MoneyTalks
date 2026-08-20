import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isMarketLensConfigured } from "@/lib/services/marketlens";
import { refreshHoldingPrices } from "@/lib/domain/investments/refreshHoldingPrices";
import { captureInvestmentSnapshots } from "@/lib/domain/investments/captureInvestmentSnapshots";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";

export const runtime = "nodejs";

/**
 * MarketLens runs on a plan that spins down when idle, so the first request of
 * the night pays a cold start. A cron is exactly where that is affordable — and
 * it is the reason this job exists: it keeps stored prices warm so a page render
 * never has to wait on a live fetch.
 */
export const maxDuration = 60;

async function runPriceCron(req: NextRequest) {
  if (!(await isAuthorizedCronRequest(req))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const marketLensConfigured = isMarketLensConfigured();
  if (!marketLensConfigured) {
    console.warn("[cron/prices] market data is not configured; recording diagnostic snapshots only");
  }

  // Cash-only accounts still need a daily valuation, so account ownership — not
  // the presence of a priceable holding — determines who participates.
  const users = await prisma.user.findMany({
    where: { financialAccounts: { some: {} } },
    select: {
      id: true,
      financialAccounts: { select: { holdings: { select: { id: true }, take: 1 } } },
    },
  });

  let updated = 0;
  let usersRefreshed = 0;
  let snapshotsRecorded = 0;
  const snapshots = { complete: 0, partial: 0, failed: 0 };
  for (const user of users) {
    const hasHoldings = user.financialAccounts.some((account) => account.holdings.length > 0);
    if (hasHoldings && marketLensConfigured) {
      try {
        const outcome = await refreshHoldingPrices(prisma, user.id, { timeoutMs: 20_000 });
        updated += outcome.updated;
        if (outcome.updated > 0) usersRefreshed += 1;
      } catch (err) {
        // Snapshot capture still runs: the stale inputs are useful diagnostics,
        // while their partial status keeps them out of performance math.
        console.warn(`[cron/prices] refresh failed for user ${user.id}:`, err);
      }
    }

    try {
      const capture = await captureInvestmentSnapshots(prisma, user.id);
      snapshots.complete += capture.complete;
      snapshots.partial += capture.partial;
      snapshots.failed += capture.failed;
      snapshotsRecorded += capture.complete + capture.partial;
    } catch (err) {
      snapshots.failed += user.financialAccounts.length;
      console.warn(`[cron/prices] snapshot capture failed for user ${user.id}:`, err);
    }
  }

  if (users.length > 0 && snapshotsRecorded === 0) {
    console.warn("[cron/prices] no investment snapshots were recorded");
    return NextResponse.json(
      {
        ok: false,
        reason: "no-snapshots-recorded",
        users: users.length,
        usersRefreshed,
        updated,
        snapshots,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, users: users.length, usersRefreshed, updated, snapshots });
}

export async function GET(req: NextRequest) {
  return runPriceCron(req);
}

export async function POST(req: NextRequest) {
  return runPriceCron(req);
}
