import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isMarketLensConfigured } from "@/lib/services/marketlens";
import { refreshHoldingPrices } from "@/lib/domain/investments/refreshHoldingPrices";
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

  if (!isMarketLensConfigured()) {
    console.warn("[cron/prices] MARKETLENS_BASE_URL / MARKETLENS_API_KEY not set; nothing attempted");
    return NextResponse.json({ ok: false, reason: "not-configured", updated: 0 }, { status: 503 });
  }

  // Only users who actually hold something priceable. Crypto is excluded in the
  // refresh itself — MarketLens is equities-only until the crypto capability is
  // ported to it.
  const users = await prisma.user.findMany({
    where: { financialAccounts: { some: { type: { not: "CRYPTO" }, holdings: { some: {} } } } },
    select: { id: true },
  });

  let updated = 0;
  let usersRefreshed = 0;
  for (const user of users) {
    try {
      const outcome = await refreshHoldingPrices(prisma, user.id, { timeoutMs: 20_000 });
      updated += outcome.updated;
      if (outcome.updated > 0) usersRefreshed += 1;
    } catch (err) {
      // One user's broken credential must not stop the sweep for everybody else.
      console.warn(`[cron/prices] refresh failed for user ${user.id}:`, err);
    }
  }

  // A sweep that priced nothing is a real gap, not a quiet success. Same shape as
  // the FX cron: report it, and leave every stored price untouched — holdings keep
  // their last-known values and the UI shows them as stale.
  if (users.length > 0 && updated === 0) {
    console.warn("[cron/prices] no prices refreshed; existing prices left untouched");
    return NextResponse.json(
      { ok: false, reason: "no-prices-available", users: users.length, updated: 0 },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, users: users.length, usersRefreshed, updated });
}

export async function GET(req: NextRequest) {
  return runPriceCron(req);
}

export async function POST(req: NextRequest) {
  return runPriceCron(req);
}
