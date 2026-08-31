import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

import { runBackfillChunk, type BackfillChunkResult } from "@/lib/domain/receipts/gmailBackfill";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";
import { sendServiceFailureAlert } from "@/lib/services/alerting";
import { enqueueCronContinuation } from "@/lib/services/qstashContinuation";

export const runtime = "nodejs";
export const maxDuration = 120;

const CONNECTION_LIMIT = 4;
const STOP_CLAIMING_AFTER_MS = 105_000;
const WINDOW_DAYS = 30;
const MAX_MESSAGES = 500;

type ClaimedConnection = { id: string };
type ConnectionResult = ({ connectionId: string } & BackfillChunkResult) | {
  connectionId: string;
  error: string;
};

type BackfillPayload = {
  connectionId?: string;
};

async function readPayload(req: NextRequest): Promise<BackfillPayload> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object") return {};
    const payload = body as Record<string, unknown>;
    return {
      connectionId: typeof payload.connectionId === "string" ? payload.connectionId : undefined,
    };
  } catch {
    return {};
  }
}

async function claimNextConnection(
  lockId: string,
  preferredConnectionId?: string | null,
): Promise<ClaimedConnection | null> {
  if (preferredConnectionId) {
    const preferredClaimed = await prisma.$queryRaw<ClaimedConnection[]>`
      WITH picked AS (
        SELECT id
        FROM "EmailConnection"
        WHERE id = ${preferredConnectionId}
          AND "backfillRequestedAt" IS NOT NULL
          AND "backfillCompletedAt" IS NULL
          AND (
            "backfillLockedAt" IS NULL
            OR "backfillLockedAt" < NOW() - INTERVAL '5 minutes'
          )
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "EmailConnection" AS connection
      SET "backfillLockedAt" = NOW(),
          "backfillLockId" = ${lockId}
      FROM picked
      WHERE connection.id = picked.id
      RETURNING connection.id;
    `;
    if (preferredClaimed[0]) return preferredClaimed[0];
  }

  const claimed = await prisma.$queryRaw<ClaimedConnection[]>`
    WITH picked AS (
      SELECT id
      FROM "EmailConnection"
      WHERE "backfillRequestedAt" IS NOT NULL
        AND "backfillCompletedAt" IS NULL
        AND (
          "backfillLockedAt" IS NULL
          OR "backfillLockedAt" < NOW() - INTERVAL '5 minutes'
        )
      ORDER BY "backfillRequestedAt" ASC, id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "EmailConnection" AS connection
    SET "backfillLockedAt" = NOW(),
        "backfillLockId" = ${lockId}
    FROM picked
    WHERE connection.id = picked.id
    RETURNING connection.id;
  `;
  return claimed[0] ?? null;
}

async function releaseConnection(
  connectionId: string,
  lockId: string,
  lastScanError: string | null,
): Promise<void> {
  await prisma.emailConnection.updateMany({
    where: { id: connectionId, backfillLockId: lockId },
    data: {
      backfillLockedAt: null,
      backfillLockId: null,
      lastScanError,
    },
  });
}

async function runGmailBackfillCron(req: NextRequest) {
  if (!(await isAuthorizedCronRequest(req))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const startedAt = Date.now();
  const lockId = randomUUID();
  const payload = await readPayload(req);
  let preferredConnectionId: string | null = payload.connectionId ?? null;

  const connections: ConnectionResult[] = [];
  const errors: Array<{ connectionId: string; error: string }> = [];
  let claimed = 0;
  let advanced = 0;
  let failed = 0;
  let processed = 0;
  let imported = 0;
  let completed = 0;

  try {
    while (claimed < CONNECTION_LIMIT && Date.now() - startedAt < STOP_CLAIMING_AFTER_MS) {
      const connection = await claimNextConnection(lockId, preferredConnectionId);
      preferredConnectionId = null;
      if (!connection) break;
      claimed += 1;

      try {
        const result = await runBackfillChunk(prisma, {
          connectionId: connection.id,
          windowDays: WINDOW_DAYS,
          maxMessages: MAX_MESSAGES,
          now: new Date(),
        });
        await releaseConnection(connection.id, lockId, null);

        connections.push({ connectionId: connection.id, ...result });
        advanced += 1;
        processed += result.processed;
        imported += result.imported;
        if (result.done) completed += 1;
      } catch (error) {
        let message = error instanceof Error ? error.message : String(error);
        try {
          await releaseConnection(connection.id, lockId, message);
        } catch (releaseError) {
          const releaseMessage = releaseError instanceof Error ? releaseError.message : String(releaseError);
          message = `${message}; failed to release backfill lease: ${releaseMessage}`;
        }
        connections.push({ connectionId: connection.id, error: message });
        errors.push({ connectionId: connection.id, error: message });
        failed += 1;
      }
    }

    if (errors.length > 0) {
      await sendServiceFailureAlert({
        serviceName: "cron/gmail-backfill",
        summary: `Failed to advance ${errors.length} Gmail backfill(s)`,
        details: { claimed, advanced, failed, errors },
      });
    }

    const remaining = await prisma.emailConnection.count({
      where: {
        backfillRequestedAt: { not: null },
        backfillCompletedAt: null,
      },
    });

    let continuation: { queued: true; messageId: string } | undefined;
    if (advanced > 0 && remaining > 0) {
      const next = await enqueueCronContinuation({
        path: "/api/cron/gmail-backfill",
        body: { source: "qstash", job: "gmail-backfill" },
        deduplicationId: `gmail-backfill-cont:${Date.now()}`,
      });
      if (next.queued) {
        continuation = next;
      }
    }

    return NextResponse.json({
      ok: true,
      claimed,
      advanced,
      failed,
      processed,
      imported,
      completed,
      remaining,
      connections,
      ...(continuation ? { continuation } : {}),
    });
  } catch (error) {
    await sendServiceFailureAlert({
      serviceName: "cron/gmail-backfill",
      summary: "Unhandled error during Gmail backfill",
      error,
    });
    return NextResponse.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return runGmailBackfillCron(req);
}

export async function POST(req: NextRequest) {
  return runGmailBackfillCron(req);
}
