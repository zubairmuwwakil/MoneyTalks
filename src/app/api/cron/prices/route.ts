import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isMarketLensConfigured } from "@/lib/services/marketlens";
import { refreshHoldingPrices } from "@/lib/domain/investments/refreshHoldingPrices";
import { captureInvestmentSnapshots } from "@/lib/domain/investments/captureInvestmentSnapshots";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";
import { sendServiceFailureAlert } from "@/lib/services/alerting";

export const runtime = "nodejs";

/**
 * MarketLens runs on a plan that spins down when idle, so the first request of
 * the night pays a cold start. A cron is exactly where that is affordable — and
 * it is the reason this job exists: it keeps stored prices warm so a page render
 * never has to wait on a live fetch.
 *
 * maxDuration is 120 s because a Java/Spring cold start can take 30–60 s alone,
 * and the original 60 s left no margin after the warmup + quote fetch + snapshot
 * capture sequence.
 */
export const maxDuration = 120;

/** Absorb MarketLens' cold start so the real quote fetch doesn't time out. */
async function warmUpMarketLens(): Promise<void> {
  const baseUrl = process.env.MARKETLENS_BASE_URL?.trim();
  if (!baseUrl) return;
  const target = baseUrl.replace(/\/+$/, "");
  const start = Date.now();
  while (Date.now() - start < 25_000) {
    try {
      const res = await fetch(target + "/actuator/health", {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(4_000),
      });
      if (res.status === 200 || res.status === 401) return;
    } catch {
      // Still spinning up; short pause before checking again
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

async function runPriceCron(req: NextRequest) {
  if (!(await isAuthorizedCronRequest(req))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const marketLensConfigured = isMarketLensConfigured();
  if (!marketLensConfigured) {
    console.warn("[cron/prices] market data is not configured; recording diagnostic snapshots only");
  }

  try {
    // Wake MarketLens before the clock starts on any per-user fetch timeout.
    // A Java/Spring cold start can take 30–60 s; absorbing it here means the
    // per-user refreshHoldingPrices call sees a warm service.
    if (marketLensConfigured) {
      await warmUpMarketLens();
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
    const refreshFailures: Array<{ userId: string; error: string }> = [];

    for (const user of users) {
      const hasHoldings = user.financialAccounts.some((account) => account.holdings.length > 0);
      let validatedHoldingIds: string[] = [];
      if (hasHoldings && marketLensConfigured) {
        try {
          const outcome = await refreshHoldingPrices(prisma, user.id, { timeoutMs: 45_000 });
          validatedHoldingIds = outcome.validatedHoldingIds;
          updated += outcome.updated;
          if (outcome.updated > 0) usersRefreshed += 1;
          if (outcome.reason) {
            console.warn(`[cron/prices] refresh degraded for user ${user.id}: ${outcome.reason}`);
            refreshFailures.push({ userId: user.id, error: outcome.reason });
          }
        } catch (err) {
          // Snapshot capture still runs: the stale inputs are useful diagnostics,
          // while their partial status keeps them out of performance math.
          const errMsg = err instanceof Error ? err.message : String(err);
          refreshFailures.push({ userId: user.id, error: errMsg });
          console.warn(`[cron/prices] refresh failed for user ${user.id}:`, err);
        }
      }

      try {
        const capture = await captureInvestmentSnapshots(prisma, user.id, { validatedHoldingIds });
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
      await sendServiceFailureAlert({
        serviceName: "cron/prices",
        summary: `No investment snapshots were recorded across ${users.length} active user(s)`,
        details: {
          users: users.length,
          usersRefreshed,
          updatedPrices: updated,
          snapshots,
          refreshFailures,
          marketLensConfigured,
        },
      });

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
  } catch (fatalError) {
    await sendServiceFailureAlert({
      serviceName: "cron/prices",
      summary: "Unhandled exception in price and portfolio snapshot cron",
      error: fatalError,
    });
    return NextResponse.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return runPriceCron(req);
}

export async function POST(req: NextRequest) {
  return runPriceCron(req);
}

