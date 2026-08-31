import { NextRequest, NextResponse } from "next/server";

import {
  GmailReprocessUnavailableError,
  reprocessStoredGmailMessages,
} from "@/lib/domain/receipts/gmailReprocessing";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

export const runtime = "nodejs";

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(number)));
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const batchSize = boundedInteger(body?.batchSize, 50, 1, 100);
  const offset = boundedInteger(body?.offset, 0, 0, Number.MAX_SAFE_INTEGER);

  const totalCount = await prisma.emailTransaction.count({
    where: { userId, provider: "GMAIL" },
  });
  const transactions = await prisma.emailTransaction.findMany({
    where: { userId, provider: "GMAIL" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: offset,
    take: batchSize,
    select: { id: true, messageId: true, connectionId: true },
  });
  let result;
  try {
    result = await reprocessStoredGmailMessages(prisma, {
      userId,
      transactions,
      mode: "reprocess",
    });
  } catch (error) {
    if (error instanceof GmailReprocessUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const nextProcessedOffset = offset + result.processed;
  const hasMore = nextProcessedOffset < totalCount;

  return NextResponse.json({
    ok: true,
    totalCount,
    processed: result.processed,
    succeeded: result.succeeded,
    failed: result.failed,
    offset,
    batchSize,
    hasMore,
    nextOffset: hasMore ? nextProcessedOffset : null,
    errors: result.errors.slice(0, 10),
    progress: totalCount === 0
      ? 100
      : Math.min(100, Math.round((nextProcessedOffset / totalCount) * 100)),
    purchasesCreated: result.purchaseActions.created,
    purchasesUpdated: result.purchaseActions.updated,
    purchasesLinked: result.purchaseActions.linked,
    purchasesDeleted: result.purchaseActions.deleted,
    purchasesUnlinked: result.purchaseActions.unlinked,
  });
}
