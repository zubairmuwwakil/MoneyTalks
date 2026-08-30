import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isMarketLensConfigured } from "@/lib/services/marketlens";
import { warmQuoteCache } from "@/lib/domain/investments/warmQuoteCache";
import { refreshHoldingPrices } from "@/lib/domain/investments/refreshHoldingPrices";
import { captureInvestmentSnapshots } from "@/lib/domain/investments/captureInvestmentSnapshots";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";
import { sendServiceFailureAlert } from "@/lib/services/alerting";
import { enqueueCronContinuation } from "@/lib/services/qstashContinuation";
import { withSpan } from "@/lib/observability";

export const runtime = "nodejs";

/**
 * Records one daily valuation per account, from prices that are as current as
 * they can honestly be made.
 *
 * ORDERING IS THE WHOLE DESIGN. MarketLens answers from a cache and only fans out
 * to its upstream provider when the cache cannot answer. That fan-out runs under
 * a deadline and is slowest on a just-woken instance. Reading before anyone has
 * warmed it means this job triggers the fan-out itself, loses the race, and is
 * served a cached price that looks exactly like a fresh one — a silently
 * one-session-stale portfolio with no error anywhere (2026-08, see
 * docs/decisions/LOG.md 2026-08-27).
 *
 * So: sweep, then read. /api/cron/prices-warmup does the same sweep 15 minutes
 * earlier and is the primary mechanism; the call here is the backstop for the
 * night it does not run.
 *
 * maxDuration is 120 s to cover the worst case of a cold sweep plus a per-user
 * refresh. On the happy path the sweep has already been done and this job
 * finishes in seconds.
 */
export const maxDuration = 120;

/**
 * How long the backstop sweep may take.
 *
 * Deliberately shorter than the warm-up cron's budget: by the time this runs the
 * sweep has usually already happened, and the job still owes everyone a recorded
 * snapshot. A sweep is worth waiting for, but never worth missing the valuation
 * over — so it is bounded, and its failure is non-fatal.
 */
const BACKSTOP_SWEEP_TIMEOUT_MS = 45_000;
const USER_BATCH_SIZE = 25;

type PriceCronPayload = {
  runId?: string;
  userCursor?: string;
};

async function readPayload(req: NextRequest): Promise<PriceCronPayload> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object") return {};
    const payload = body as Record<string, unknown>;
    return {
      runId: typeof payload.runId === "string" ? payload.runId.slice(0, 100) : undefined,
      userCursor:
        typeof payload.userCursor === "string" && payload.userCursor.length > 0
          ? payload.userCursor.slice(0, 100)
          : undefined,
    };
  } catch {
    return {};
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

  const payload = await readPayload(req);
  const runId = payload.runId ?? crypto.randomUUID();

  try {
    // Correct the cache before reading it. Never fatal: a sweep that fails leaves
    // stored prices untouched (E4), and a stale-but-recorded valuation, honestly
    // labelled, beats no valuation at all.
    let sweep = null;
    if (marketLensConfigured) {
      sweep = await warmQuoteCache(prisma, { timeoutMs: BACKSTOP_SWEEP_TIMEOUT_MS });
      if (!sweep.ok) {
        console.warn(
          `[cron/prices] warm sweep did not warm everything (${sweep.fresh}/${sweep.symbols} fresh); ` +
            `causes=${JSON.stringify(sweep.causes)} reason=${sweep.reason ?? "none"}`,
        );
      }
    }

    // Cash-only accounts still need a daily valuation, so account ownership — not
    // the presence of a priceable holding — determines who participates.
    const users = await withSpan(
      "cron.prices.load-user-batch",
      () => prisma.user.findMany({
        where: { financialAccounts: { some: {} } },
        ...(payload.userCursor ? { cursor: { id: payload.userCursor }, skip: 1 } : {}),
        orderBy: { id: "asc" },
        take: USER_BATCH_SIZE,
        select: {
          id: true,
          financialAccounts: { select: { holdings: { select: { id: true }, take: 1 } } },
        },
      }),
      { batch_size: USER_BATCH_SIZE },
    );

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
          // The sweep report names WHY MarketLens could not price things —
          // provider_deadline_exceeded, budget_exhausted, session_in_progress.
          // Without it an alert says "nothing worked" and nothing more.
          sweep,
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

    const hasMore = users.length === USER_BATCH_SIZE;
    let continuation: { queued: true; messageId: string } | undefined;
    if (hasMore) {
      const next = await enqueueCronContinuation({
        path: "/api/cron/prices",
        body: { source: "qstash", job: "prices", runId, userCursor: users.at(-1)?.id },
        deduplicationId: `prices:${runId}:${users.at(-1)?.id ?? "missing"}`,
      });
      if (!next.queued) {
        await sendServiceFailureAlert({
          serviceName: "cron/prices",
          summary: "Price cron reached its batch limit but cannot enqueue its continuation",
          details: { users: users.length, userCursor: users.at(-1)?.id, runId },
        });
        return NextResponse.json(
          { ok: false, reason: "continuation-not-configured", users: users.length, snapshots },
          { status: 503 },
        );
      }
      continuation = next;
    }

    return NextResponse.json({
      ok: true,
      users: users.length,
      usersRefreshed,
      updated,
      snapshots,
      ...(continuation ? { continuation } : {}),
    });
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
