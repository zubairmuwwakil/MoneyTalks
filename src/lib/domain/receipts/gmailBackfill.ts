import type { PrismaClient } from "@prisma/client";

import { processRawGmailMessage } from "./gmailReceiptProcessing";
import { getAuthedGmail } from "@/lib/services/gmailClient";
import { hasGmailReadScope, listRawGmailMessagesInWindow } from "@/lib/services/gmailScanSource";

const DAY_MS = 24 * 60 * 60 * 1_000;
const BACKFILL_MONTHS = 24;

type BackfillChunkOptions = {
  connectionId: string;
  windowDays: number;
  maxMessages: number;
  now: Date;
};

export type BackfillChunkResult = {
  processed: number;
  imported: number;
  windowFrom: string;
  windowTo: string;
  done: boolean;
};

function utcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string | null, fallback: Date): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || isoDate(parsed) !== value) return fallback;
  // A future cursor is just as unsafe as a malformed one: restart at today so
  // a corrupted value cannot make the job spend months walking empty history.
  return parsed > fallback ? fallback : parsed;
}

function monthsBefore(date: Date, months: number): Date {
  const targetMonth = date.getUTCMonth() - months;
  const firstOfMonth = new Date(Date.UTC(date.getUTCFullYear(), targetMonth, 1));
  const lastDay = new Date(Date.UTC(
    firstOfMonth.getUTCFullYear(),
    firstOfMonth.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  firstOfMonth.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return firstOfMonth;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

/** Advance one owner-requested connection backwards by one bounded date window. */
export async function runBackfillChunk(
  db: PrismaClient,
  opts: BackfillChunkOptions,
): Promise<BackfillChunkResult> {
  assertPositiveInteger(opts.windowDays, "windowDays");
  assertPositiveInteger(opts.maxMessages, "maxMessages");

  const connection = await db.emailConnection.findUnique({
    where: { id: opts.connectionId },
    select: {
      id: true,
      userId: true,
      backfillRequestedAt: true,
      backfillCursor: true,
      backfillCompletedAt: true,
    },
  });
  if (!connection) throw new Error(`Gmail connection ${opts.connectionId} not found`);
  if (!connection.backfillRequestedAt) {
    throw new Error(`Historical backfill was not requested for connection ${opts.connectionId}`);
  }

  const today = utcDate(opts.now);
  const cutoff = monthsBefore(today, BACKFILL_MONTHS);
  const cursor = parseIsoDate(connection.backfillCursor, today);
  const windowTo = cursor <= cutoff ? cutoff : cursor;

  // A prior chunk may have landed exactly on the cutoff. Complete without an
  // empty Gmail call or a 25th month of history.
  if (cursor <= cutoff) {
    await db.emailConnection.update({
      where: { id: connection.id },
      data: { backfillCursor: isoDate(cutoff), backfillCompletedAt: opts.now },
    });
    return {
      processed: 0,
      imported: 0,
      windowFrom: isoDate(cutoff),
      windowTo: isoDate(windowTo),
      done: true,
    };
  }

  const candidateFrom = new Date(cursor.getTime() - opts.windowDays * DAY_MS);
  let windowFrom = candidateFrom < cutoff ? cutoff : candidateFrom;

  const authed = await getAuthedGmail(connection.id);
  if (!authed) throw new Error(`Gmail connection ${connection.id} is not connected`);
  if (!hasGmailReadScope(authed.conn.scope)) {
    throw new Error(`Gmail connection ${connection.id} is missing Gmail read scope`);
  }

  let processed = 0;
  let imported = 0;
  try {
    let messages;
    while (true) {
      // One extra result is an overflow sentinel. Advancing a date cursor after
      // a capped result would silently skip the rest of a crowded month.
      messages = await listRawGmailMessagesInWindow(authed.gmail, {
        after: windowFrom,
        before: windowTo,
        max: opts.maxMessages + 1,
      });
      if (messages.length <= opts.maxMessages) break;

      const spanDays = Math.round((windowTo.getTime() - windowFrom.getTime()) / DAY_MS);
      if (spanDays <= 1) {
        throw new Error(
          `Gmail backfill has more than ${opts.maxMessages} messages in one day; cursor was not advanced`,
        );
      }
      // Keep the newer half. The next invocation resumes from its start and
      // naturally covers the older half, preserving the backwards walk.
      windowFrom = new Date(windowTo.getTime() - Math.ceil(spanDays / 2) * DAY_MS);
    }

    const done = windowFrom.getTime() === cutoff.getTime();

    for (const message of messages) {
      const result = await processRawGmailMessage(db, {
        userId: connection.userId,
        message,
        mode: "scan",
        connectionId: connection.id,
      });
      processed += 1;
      if (result.transactionAction === "created") imported += 1;
    }

    // This is deliberately last. Any fetch, parse, or persistence failure
    // leaves the window eligible for an idempotent retry.
    await db.emailConnection.update({
      where: { id: connection.id },
      data: {
        backfillCursor: isoDate(windowFrom),
        ...(done ? { backfillCompletedAt: opts.now } : {}),
      },
    });
  } finally {
    await authed.flushTokens();
  }

  return {
    processed,
    imported,
    windowFrom: isoDate(windowFrom),
    windowTo: isoDate(windowTo),
    done: windowFrom.getTime() === cutoff.getTime(),
  };
}
