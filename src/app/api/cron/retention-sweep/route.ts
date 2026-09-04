import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COMMUNITY_MCC_RETENTION_DAYS } from "@/lib/community-merchant-mcc";
import { deleteExpiredWalletDiagnostics } from "@/lib/domain/wallet/diagnostics";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";
import { sendServiceFailureAlert } from "@/lib/services/alerting";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * One nightly job for every "delete rows past their retention window" sweep.
 *
 * These were two schedules doing the same shape of work — an indexed deleteMany
 * returning a count — against a QStash account capped at ten. Neither needs its
 * own schedule, retry policy, or alert channel, and splitting them bought
 * nothing but a slot each.
 *
 * Domains are swept independently: a failure in one must not skip the other,
 * because the sweep that did not run is invisible until its table is already
 * oversized. Every delete here is idempotent, so a 500 that makes QStash retry
 * the whole job re-runs the successful sweeps harmlessly.
 */
const sweeps = [
  {
    domain: "wallet-diagnostics",
    run: async () => (await deleteExpiredWalletDiagnostics()).count,
  },
  {
    domain: "community-merchant-mcc",
    run: async () => {
      const cutoff = new Date(Date.now() - COMMUNITY_MCC_RETENTION_DAYS * 86_400_000);
      const result = await prisma.communityMerchantMCCObservation.deleteMany({
        where: { observedAt: { lt: cutoff } },
      });
      return result.count;
    },
  },
];

async function run(req: NextRequest) {
  if (!(await isAuthorizedCronRequest(req))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const deleted: Record<string, number> = {};
  const failed: string[] = [];

  for (const sweep of sweeps) {
    try {
      deleted[sweep.domain] = await sweep.run();
    } catch (error) {
      failed.push(sweep.domain);
      await sendServiceFailureAlert({
        serviceName: `cron/retention-sweep:${sweep.domain}`,
        summary: `Unable to delete expired ${sweep.domain} rows`,
        error,
      });
    }
  }

  if (failed.length) {
    return NextResponse.json({ ok: false, deleted, failed }, { status: 500 });
  }
  return NextResponse.json({ ok: true, deleted });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
