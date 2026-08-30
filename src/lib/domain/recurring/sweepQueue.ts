import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export type ClaimedRecurringSweepJob = {
  userId: string;
  attempts: number;
};

const RETRY_MINUTES = [5, 30, 120, 720, 1_440] as const;
const DAY_MS = 86_400_000;

/** Add one durable recurring work item for every owner with purchase evidence. */
export async function enqueueRecurringSweepJobs(db: PrismaClient): Promise<number> {
  return db.$executeRaw`
    INSERT INTO "RecurringSweepJob" (
      "userId", status, "runAt", attempts, "createdAt", "updatedAt"
    )
    SELECT u.id, 'PENDING'::"RecurringSweepJobStatus", NOW(), 0, NOW(), NOW()
    FROM "User" u
    WHERE EXISTS (
      SELECT 1 FROM "Purchase" p WHERE p."userId" = u.id
    )
    ON CONFLICT ("userId") DO NOTHING
  `;
}

/**
 * Atomically lease a bounded batch. SKIP LOCKED lets overlapping QStash
 * deliveries share work without ever sweeping the same owner concurrently.
 */
export async function claimRecurringSweepJobs(
  db: PrismaClient,
  limit: number,
): Promise<{ lockId: string; jobs: ClaimedRecurringSweepJob[] }> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("limit must be a positive safe integer");
  const lockId = crypto.randomUUID();
  const jobs = await db.$queryRaw<ClaimedRecurringSweepJob[]>`
    WITH picked AS (
      SELECT "userId"
      FROM "RecurringSweepJob"
      WHERE (
        status = 'PENDING'::"RecurringSweepJobStatus"
        AND "runAt" <= NOW()
      ) OR (
        status = 'RUNNING'::"RecurringSweepJobStatus"
        AND "lockedAt" < NOW() - INTERVAL '10 minutes'
      )
      ORDER BY "runAt" ASC, "userId" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "RecurringSweepJob" j
    SET status = 'RUNNING'::"RecurringSweepJobStatus",
        "lockedAt" = NOW(),
        "lockId" = ${lockId},
        attempts = attempts + 1,
        "updatedAt" = NOW()
    FROM picked
    WHERE j."userId" = picked."userId"
    RETURNING j."userId", j.attempts
  `;
  return { lockId, jobs };
}

export function nextRecurringSweepRetryAt(now: Date, attempts: number): Date {
  const index = Math.max(0, Math.min(attempts - 1, RETRY_MINUTES.length - 1));
  return new Date(now.getTime() + RETRY_MINUTES[index] * 60_000);
}

export async function completeRecurringSweepJob(
  db: PrismaClient,
  args: { userId: string; lockId: string; completedAt?: Date },
): Promise<void> {
  const completedAt = args.completedAt ?? new Date();
  const result = await db.recurringSweepJob.updateMany({
    where: { userId: args.userId, status: "RUNNING", lockId: args.lockId },
    data: {
      status: "PENDING",
      runAt: new Date(completedAt.getTime() + DAY_MS),
      attempts: 0,
      lastError: null,
      lockedAt: null,
      lockId: null,
      lastSweptAt: completedAt,
    },
  });
  if (result.count !== 1) throw new Error(`recurring sweep lease lost for ${args.userId}`);
}

export async function failRecurringSweepJob(
  db: PrismaClient,
  args: { userId: string; lockId: string; attempts: number; error: string; failedAt?: Date },
): Promise<void> {
  const failedAt = args.failedAt ?? new Date();
  const result = await db.recurringSweepJob.updateMany({
    where: { userId: args.userId, status: "RUNNING", lockId: args.lockId },
    data: {
      status: "PENDING",
      runAt: nextRecurringSweepRetryAt(failedAt, args.attempts),
      lastError: args.error.slice(0, 2_000),
      lockedAt: null,
      lockId: null,
    },
  });
  if (result.count !== 1) throw new Error(`recurring sweep lease lost for ${args.userId}`);
}
