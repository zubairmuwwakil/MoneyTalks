import { type NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Pings MarketLens 5 minutes before /api/cron/prices runs (01:55 UTC vs 02:00 UTC).
 * On platforms like Render that spin down on idle, this absorbs the cold start
 * completely ahead of time so the prices cron executes in < 2 seconds.
 */
async function runWarmupCron(req: NextRequest) {
  if (!(await isAuthorizedCronRequest(req))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const baseUrl = process.env.MARKETLENS_BASE_URL?.trim();
  if (!baseUrl) {
    return NextResponse.json({ ok: false, reason: "MARKETLENS_BASE_URL not configured" }, { status: 200 });
  }

  const target = baseUrl.replace(/\/+$/, "");
  let status = 0;
  try {
    const res = await fetch(target + "/actuator/health", {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(50_000),
    });
    status = res.status;
  } catch (err) {
    console.warn("[cron/prices-warmup] Warmup ping timed out or failed:", err);
  }

  return NextResponse.json({ ok: true, target, status });
}

export async function GET(req: NextRequest) {
  return runWarmupCron(req);
}

export async function POST(req: NextRequest) {
  return runWarmupCron(req);
}
