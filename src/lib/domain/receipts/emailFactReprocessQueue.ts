import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { EXTRACTOR_VERSIONS } from "./parserVersions";

export const EMAIL_FACT_PROJECTION_VERSION = Object.entries(EXTRACTOR_VERSIONS)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([extractorId, version]) => `${extractorId}:${version}`)
  .join("|");

export type ClaimedEmailFactReprocessJob = {
  userId: string;
  targetVersion: string;
  attempts: number;
  cursorCreatedAt: Date | null;
  cursorId: string | null;
};

const RETRY_MINUTES = [5, 30, 120, 720, 1_440] as const;

/** Add one replay job for every owner with a stored Gmail transaction. */
export async function enqueueEmailFactReprocessJobs(db: PrismaClient): Promise<number> {
  return db.$executeRaw`
    INSERT INTO "EmailFactReprocessJob" (
      "userId", status, "targetVersion", "runAt", attempts, "createdAt", "updatedAt"
    )
    SELECT DISTINCT et."userId", 'PENDING'::"EmailFactReprocessJobStatus",
      ${EMAIL_FACT_PROJECTION_VERSION}, NOW(), 0, NOW(), NOW()
    FROM "EmailTransaction" et
    WHERE et.provider = 'GMAIL'::"EmailProvider"
    ON CONFLICT ("userId") DO UPDATE
    SET status = 'PENDING'::"EmailFactReprocessJobStatus",
        "targetVersion" = EXCLUDED."targetVersion",
        "completedVersion" = NULL,
        "runAt" = NOW(),
        attempts = 0,
        "lastError" = NULL,
        "lockedAt" = NULL,
        "lockId" = NULL,
        "cursorCreatedAt" = NULL,
        "cursorId" = NULL,
        "completedAt" = NULL,
        "updatedAt" = NOW()
    WHERE "EmailFactReprocessJob"."targetVersion" <> EXCLUDED."targetVersion"
      AND (
        "EmailFactReprocessJob".status <> 'RUNNING'::"EmailFactReprocessJobStatus"
        OR "EmailFactReprocessJob"."lockedAt" < NOW() - INTERVAL '10 minutes'
      )
  `;
}

/** Atomically lease one owner so the route can stop claiming near its deadline. */
export async function claimNextEmailFactReprocessJob(
  db: PrismaClient,
): Promise<{ lockId: string; job: ClaimedEmailFactReprocessJob } | null> {
  const lockId = crypto.randomUUID();
  const jobs = await db.$queryRaw<ClaimedEmailFactReprocessJob[]>`
    WITH picked AS (
      SELECT "userId"
      FROM "EmailFactReprocessJob"
      WHERE (
        status = 'PENDING'::"EmailFactReprocessJobStatus"
        AND "runAt" <= NOW()
      ) OR (
        status = 'RUNNING'::"EmailFactReprocessJobStatus"
        AND "lockedAt" < NOW() - INTERVAL '10 minutes'
      )
      ORDER BY "runAt" ASC, "userId" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "EmailFactReprocessJob" j
    SET status = 'RUNNING'::"EmailFactReprocessJobStatus",
        "lockedAt" = NOW(),
        "lockId" = ${lockId},
        attempts = attempts + 1,
        "updatedAt" = NOW()
    FROM picked
    WHERE j."userId" = picked."userId"
    RETURNING j."userId", j."targetVersion", j.attempts,
      j."cursorCreatedAt", j."cursorId"
  `;
  return jobs[0] ? { lockId, job: jobs[0] } : null;
}

export async function completeEmailFactReprocessChunk(
  db: PrismaClient,
  args: {
    userId: string;
    lockId: string;
    targetVersion: string;
    hasMore: boolean;
    cursor?: { createdAt: Date; id: string };
    completedAt?: Date;
  },
): Promise<void> {
  const completedAt = args.completedAt ?? new Date();
  if (args.hasMore && !args.cursor) throw new Error("a continuing email fact replay requires a cursor");
  const data = args.hasMore
    ? {
        status: "PENDING" as const,
        runAt: completedAt,
        cursorCreatedAt: args.cursor!.createdAt,
        cursorId: args.cursor!.id,
        attempts: 0,
        lastError: null,
        lockedAt: null,
        lockId: null,
      }
    : {
        status: "COMPLETE" as const,
        completedVersion: args.targetVersion,
        completedAt,
        cursorCreatedAt: null,
        cursorId: null,
        attempts: 0,
        lastError: null,
        lockedAt: null,
        lockId: null,
      };
  const result = await db.emailFactReprocessJob.updateMany({
    where: {
      userId: args.userId,
      status: "RUNNING",
      lockId: args.lockId,
      targetVersion: args.targetVersion,
    },
    data,
  });
  if (result.count !== 1) throw new Error(`email fact reprocess lease lost for ${args.userId}`);
}

export function nextEmailFactReprocessRetryAt(now: Date, attempts: number): Date {
  const index = Math.max(0, Math.min(attempts - 1, RETRY_MINUTES.length - 1));
  return new Date(now.getTime() + RETRY_MINUTES[index] * 60_000);
}

export async function failEmailFactReprocessJob(
  db: PrismaClient,
  args: { userId: string; lockId: string; attempts: number; error: string; failedAt?: Date },
): Promise<void> {
  const failedAt = args.failedAt ?? new Date();
  const result = await db.emailFactReprocessJob.updateMany({
    where: { userId: args.userId, status: "RUNNING", lockId: args.lockId },
    data: {
      status: "PENDING",
      runAt: nextEmailFactReprocessRetryAt(failedAt, args.attempts),
      lastError: args.error.slice(0, 2_000),
      lockedAt: null,
      lockId: null,
    },
  });
  if (result.count !== 1) throw new Error(`email fact reprocess lease lost for ${args.userId}`);
}

export async function countPendingEmailFactReprocessJobs(db: PrismaClient): Promise<number> {
  return db.emailFactReprocessJob.count({
    where: {
      targetVersion: EMAIL_FACT_PROJECTION_VERSION,
      status: { in: ["PENDING", "RUNNING"] },
    },
  });
}
