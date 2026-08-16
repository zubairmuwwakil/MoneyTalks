import { prisma } from "@/lib/prisma";
import { DateTime } from "luxon";
import crypto from "crypto";

type Prefs = { timezone: string; digestHourLocal: number };

export function computeNextDigestJob(now: Date, prefs: Prefs) {
  const tz = prefs.timezone || "America/Toronto";
  const hour = prefs.digestHourLocal ?? 9;

  const nowZ = DateTime.fromJSDate(now, { zone: tz });

  let sendLocal = nowZ.set({ hour, minute: 0, second: 0, millisecond: 0 });
  if (sendLocal < nowZ) sendLocal = sendLocal.plus({ days: 1 });

  const localDate = sendLocal.toISODate()!;     // YYYY-MM-DD in user TZ
  const sendAt = sendLocal.toUTC().toJSDate();  // store UTC
  const dedupeKey = `digest:${localDate}`;

  return { localDate, sendAt, dedupeKey };
}

export async function scheduleNextDigestJob(userId: string, prefs: Prefs, now = new Date()) {
  const { sendAt, dedupeKey } = computeNextDigestJob(now, prefs);

  const existing = await prisma.notificationJob.findUnique({
    where: { userId_dedupeKey: { userId, dedupeKey } },
    select: { id: true, status: true },
  });

  if (existing?.status === "SENT") return;

  if (existing) {
    await prisma.notificationJob.update({
      where: { id: existing.id },
      data: {
        channel: "EMAIL_DIGEST",
        status: "PENDING",
        sendAt,
        lockedAt: null,
        lockId: null,
        lastError: null,
      },
    });
    return;
  }

  await prisma.notificationJob.create({
    data: {
      userId,
      channel: "EMAIL_DIGEST",
      status: "PENDING",
      sendAt,
      dedupeKey,
    },
  });
}

export async function cancelPendingDigestJobs(userId: string) {
  await prisma.notificationJob.updateMany({
    where: {
      userId,
      channel: "EMAIL_DIGEST",
      notificationId: null,
      status: { in: ["PENDING", "SENDING"] },
    },
    data: { status: "CANCELED", lockedAt: null, lockId: null },
  });
}

export async function claimDueDigestJobs(limit = 25) {
  const lockId = crypto.randomUUID();

  const jobs = await prisma.$queryRaw<any[]>`
    WITH picked AS (
      SELECT id
      FROM "NotificationJob"
      WHERE status = 'PENDING'
        AND channel = 'EMAIL_DIGEST'
        AND "notificationId" IS NULL
        AND "sendAt" <= NOW()
        AND ("lockedAt" IS NULL OR "lockedAt" < NOW() - INTERVAL '10 minutes')
      ORDER BY "sendAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "NotificationJob" j
    SET status = 'SENDING',
        "lockedAt" = NOW(),
        "lockId" = ${lockId},
        attempts = attempts + 1
    FROM picked
    WHERE j.id = picked.id
    RETURNING j.*;
  `;

  return { lockId, jobs };
}

export function nextRetrySendAt(now: Date, attempts: number) {
  const minutes = [5, 30, 120, 720, 1440][Math.min(attempts - 1, 4)];
  return new Date(now.getTime() + minutes * 60_000);
}
