import { type NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";
import { prisma } from "@/lib/prisma";
import { warmQuoteCache } from "@/lib/domain/investments/warmQuoteCache";
import { sendServiceFailureAlert } from "@/lib/services/alerting";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Deliberately generous. This job exists to absorb a cold start plus a full
 * provider fan-out so nothing downstream has to. Finishing slowly is the goal;
 * giving up early is the failure being fixed.
 */
const WARMUP_TIMEOUT_MS = 110_000;

/**
 * Warms MarketLens' provider path before /api/cron/prices reads it
 * (01:45 UTC vs 02:00 UTC).
 *
 * WHAT THIS IS FOR — read before changing the schedule or the call below.
 *
 * MarketLens serves quotes from a cache and only fans out to Yahoo when the cache
 * cannot answer. That fan-out is the expensive step, it runs under a deadline, and
 * on a host that spins down when idle it is at its slowest exactly when the
 * nightly cron needs it. Whoever triggers the first fan-out of the night pays for
 * it; whoever loses the race is served a cached price that is indistinguishable
 * from a real one.
 *
 * For weeks in 2026-08 the loser was the price cron, every single night, and the
 * result was a portfolio permanently one session behind with no error anywhere.
 * See docs/decisions/LOG.md 2026-08-27.
 *
 * So this job does the fan-out itself, 15 minutes early, where there is time for
 * it and where failing is a 502 somebody is told about. By 02:00 the price cron
 * reads an already-correct cache in milliseconds.
 *
 * It warms only the symbols we actually hold, via the ordinary quotes endpoint
 * with refresh=true. MarketLens' global sweep needs an ADMIN role this app's key
 * does not carry, and warming symbols nobody here owns is not our business.
 *
 * This previously pinged /actuator/health. That woke the HTTP layer and proved
 * nothing about the provider path — a green warm-up in front of a cold fan-out.
 * Do not revert it to a health check.
 */
async function runWarmupCron(req: NextRequest) {
  if (!(await isAuthorizedCronRequest(req))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const sweep = await warmQuoteCache(prisma, { timeoutMs: WARMUP_TIMEOUT_MS });

  if (!sweep.ok) {
    await sendServiceFailureAlert({
      serviceName: "cron/prices-warmup",
      summary:
        sweep.reason === "unreachable"
          ? "MarketLens could not be reached to warm quotes before the price cron"
          : `MarketLens warmed ${sweep.fresh}/${sweep.symbols} held symbol(s)`,
      details: { ...sweep },
    });

    // 502, not 200-with-a-warning: the price cron is 15 minutes away and will now
    // read a cache nobody corrected. QStash retries this, and a retry that lands
    // before 02:00 still saves the night.
    return NextResponse.json({ ...sweep }, { status: 502 });
  }

  return NextResponse.json({ ...sweep });
}

export async function GET(req: NextRequest) {
  return runWarmupCron(req);
}

export async function POST(req: NextRequest) {
  return runWarmupCron(req);
}
