import { type NextRequest, NextResponse } from "next/server";

import { sweepRecurringObligations } from "@/lib/domain/recurring/detectRecurring";
import {
  claimRecurringSweepJobs,
  completeRecurringSweepJob,
  enqueueRecurringSweepJobs,
  failRecurringSweepJob,
} from "@/lib/domain/recurring/sweepQueue";
import { prisma } from "@/lib/prisma";
import { recordRecurringSweepOutcome } from "@/lib/observability";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";
import { sendServiceFailureAlert } from "@/lib/services/alerting";

export const runtime = "nodejs";
export const maxDuration = 120;

const ALGORITHM_VERSION = 1;
// A sweep reads and re-derives one owner's full purchase history. Keep enough
// headroom inside the platform limit for queue bookkeeping and failure alerts.
const SWEEP_BATCH_LIMIT = 8;
const DEFAULT_TIME_ZONE = "America/Toronto";

async function runRecurringSweepCron(req: NextRequest) {
  if (!(await isAuthorizedCronRequest(req))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const enqueued = await enqueueRecurringSweepJobs(prisma);
    const { lockId, jobs } = await claimRecurringSweepJobs(prisma, SWEEP_BATCH_LIMIT);
    let swept = 0;
    let failed = 0;
    const errors: Array<{ userId: string; error: string }> = [];

    for (const job of jobs) {
      try {
        const preference = await prisma.notificationPreference.findUnique({
          where: { userId: job.userId },
          select: { timezone: true },
        });
        const result = await sweepRecurringObligations(prisma, {
          userId: job.userId,
          timeZone: preference?.timezone || DEFAULT_TIME_ZONE,
          algorithmVersion: ALGORITHM_VERSION,
        });
        recordRecurringSweepOutcome("completed");
        recordRecurringSweepOutcome("created", result.created);
        recordRecurringSweepOutcome("updated", result.updated);
        recordRecurringSweepOutcome("unchanged", result.unchanged);
        recordRecurringSweepOutcome("skipped", result.skipped);
        await completeRecurringSweepJob(prisma, { userId: job.userId, lockId });
        swept += 1;
      } catch (error) {
        recordRecurringSweepOutcome("failed");
        const message = error instanceof Error ? error.message : String(error);
        try {
          await failRecurringSweepJob(prisma, {
            userId: job.userId,
            lockId,
            attempts: job.attempts,
            error: message,
          });
        } catch (queueError) {
          const queueMessage = queueError instanceof Error ? queueError.message : String(queueError);
          errors.push({ userId: job.userId, error: `${message}; queue release failed: ${queueMessage}` });
          failed += 1;
          continue;
        }
        errors.push({ userId: job.userId, error: message });
        failed += 1;
      }
    }

    if (errors.length > 0) {
      await sendServiceFailureAlert({
        serviceName: "cron/recurring-sweep",
        summary: `Failed to sweep ${errors.length} owner(s)`,
        details: { claimed: jobs.length, swept, failed, errors },
      });
    }

    return NextResponse.json({
      ok: true,
      enqueued,
      claimed: jobs.length,
      swept,
      failed,
      errors,
    });
  } catch (error) {
    await sendServiceFailureAlert({
      serviceName: "cron/recurring-sweep",
      summary: "Unhandled error during recurring obligation sweep",
      error,
    });
    return NextResponse.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return runRecurringSweepCron(req);
}

export async function POST(req: NextRequest) {
  return runRecurringSweepCron(req);
}
