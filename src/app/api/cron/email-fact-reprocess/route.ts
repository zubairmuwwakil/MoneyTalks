import { type NextRequest, NextResponse } from "next/server";

import {
  claimNextEmailFactReprocessJob,
  completeEmailFactReprocessChunk,
  countPendingEmailFactReprocessJobs,
  enqueueEmailFactReprocessJobs,
  failEmailFactReprocessJob,
} from "@/lib/domain/receipts/emailFactReprocessQueue";
import { reprocessStoredGmailMessages } from "@/lib/domain/receipts/gmailReprocessing";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";
import { sendServiceFailureAlert } from "@/lib/services/alerting";
import {
  enqueueCronContinuation,
  isQstashContinuationConfigured,
} from "@/lib/services/qstashContinuation";

export const runtime = "nodejs";
export const maxDuration = 120;

const OWNER_LIMIT = 4;
const MESSAGE_LIMIT = 25;
const STOP_CLAIMING_AFTER_MS = 105_000;

/**
 * SAFETY BOUNDARY: this unattended path re-derives EmailObligationFact only.
 * Full `reprocess` can rewrite, unlink, or delete real Purchase rows, and those
 * outcomes commit before a route-level action cap can observe them. A dry run
 * would avoid damage but would not prune the stale facts this job exists to
 * repair. Parser version is not a safe selector either: fact extractors have
 * independent versions (for example cancellation advanced while the parser did
 * not). The owner-triggered route retains full purchase reconciliation; do not
 * broaden this cron without a separately reviewed, pre-commit safety design.
 */
async function runEmailFactReprocessCron(req: NextRequest) {
  if (!(await isAuthorizedCronRequest(req))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const startedAt = Date.now();
  let enqueued = 0;
  let claimed = 0;
  let advanced = 0;
  let completed = 0;
  let failed = 0;
  let processed = 0;
  let succeeded = 0;
  let messageFailures = 0;
  const errors: Array<{ userId: string; error: string }> = [];

  try {
    enqueued = await enqueueEmailFactReprocessJobs(prisma);

    while (claimed < OWNER_LIMIT && Date.now() - startedAt < STOP_CLAIMING_AFTER_MS) {
      const claim = await claimNextEmailFactReprocessJob(prisma);
      if (!claim) break;
      claimed += 1;
      const { job, lockId } = claim;

      try {
        const cursorFilter = job.cursorCreatedAt && job.cursorId
          ? {
              OR: [
                { createdAt: { gt: job.cursorCreatedAt } },
                { createdAt: job.cursorCreatedAt, id: { gt: job.cursorId } },
              ],
            }
          : {};
        const rows = await prisma.emailTransaction.findMany({
          where: { userId: job.userId, provider: "GMAIL", ...cursorFilter },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: MESSAGE_LIMIT + 1,
          select: { id: true, messageId: true, connectionId: true, createdAt: true },
        });
        const transactions = rows.slice(0, MESSAGE_LIMIT);
        const hasMore = rows.length > MESSAGE_LIMIT;
        const result = transactions.length > 0
          ? await reprocessStoredGmailMessages(prisma, {
              userId: job.userId,
              transactions,
              mode: "facts-reprocess",
            })
          : { processed: 0, succeeded: 0, failed: 0, errors: [] };
        const cursor = transactions.at(-1);

        await completeEmailFactReprocessChunk(prisma, {
          userId: job.userId,
          lockId,
          targetVersion: job.targetVersion,
          hasMore,
          ...(cursor ? { cursor: { createdAt: cursor.createdAt, id: cursor.id } } : {}),
        });
        advanced += 1;
        if (!hasMore) completed += 1;
        processed += result.processed;
        succeeded += result.succeeded;
        messageFailures += result.failed;
        for (const error of result.errors) {
          errors.push({ userId: job.userId, error: `${error.messageId}: ${error.error}` });
        }
      } catch (error) {
        let message = error instanceof Error ? error.message : String(error);
        try {
          await failEmailFactReprocessJob(prisma, {
            userId: job.userId,
            lockId,
            attempts: job.attempts,
            error: message,
          });
        } catch (releaseError) {
          const releaseMessage = releaseError instanceof Error ? releaseError.message : String(releaseError);
          message = `${message}; queue release failed: ${releaseMessage}`;
        }
        errors.push({ userId: job.userId, error: message });
        failed += 1;
      }
    }

    if (errors.length > 0) {
      await sendServiceFailureAlert({
        serviceName: "cron/email-fact-reprocess",
        summary: `Email fact replay had ${errors.length} failure(s)`,
        details: { claimed, advanced, completed, failed, messageFailures, errors: errors.slice(0, 20) },
      });
    }

    const remaining = await countPendingEmailFactReprocessJobs(prisma);
    let continuation: { queued: true; messageId: string } | undefined;
    if (advanced > 0 && remaining > 0 && isQstashContinuationConfigured()) {
      const next = await enqueueCronContinuation({
        path: "/api/cron/email-fact-reprocess",
        body: { source: "qstash", job: "email-fact-reprocess" },
        deduplicationId: `email-fact-reprocess-cont:${Date.now()}`,
      });
      if (next.queued) continuation = next;
    }

    return NextResponse.json({
      ok: true,
      enqueued,
      claimed,
      advanced,
      completed,
      failed,
      processed,
      succeeded,
      messageFailures,
      remaining,
      errors: errors.slice(0, 20),
      ...(continuation ? { continuation } : {}),
    });
  } catch (error) {
    await sendServiceFailureAlert({
      serviceName: "cron/email-fact-reprocess",
      summary: "Unhandled error during email fact replay",
      error,
    });
    return NextResponse.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return runEmailFactReprocessCron(req);
}

export async function POST(req: NextRequest) {
  return runEmailFactReprocessCron(req);
}
