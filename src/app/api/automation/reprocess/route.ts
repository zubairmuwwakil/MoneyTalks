import { NextRequest, NextResponse } from "next/server";

import { processRawGmailMessage, type GmailPurchaseAction } from "@/lib/domain/receipts/gmailReceiptProcessing";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";
import { getAuthedGmail, listUserConnections } from "@/lib/services/gmailClient";
import { hasGmailReadScope, listRecentRawGmailMessages } from "@/lib/services/gmailScanSource";

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

  const connections = await listUserConnections(userId);
  if (connections.length === 0) {
    return NextResponse.json(
      { error: "Gmail not connected. Connect it in Settings → Automation." },
      { status: 400 },
    );
  }

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

  type AuthedGmail = Awaited<ReturnType<typeof getAuthedGmail>>;
  const authByConnection = new Map<string, Promise<AuthedGmail>>();
  const authenticate = (connectionId: string) => {
    const cached = authByConnection.get(connectionId);
    if (cached) return cached;
    const pending = getAuthedGmail(connectionId);
    authByConnection.set(connectionId, pending);
    return pending;
  };

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const errors: Array<{ messageId: string; error: string }> = [];
  const purchaseActions: Record<GmailPurchaseAction, number> = {
    none: 0,
    created: 0,
    updated: 0,
    linked: 0,
    deleted: 0,
    unlinked: 0,
  };

  try {
    for (const transaction of transactions) {
      processed++;

      try {
        // New rows know their mailbox. Legacy rows predate connectionId, so
        // try each of the owner's mailboxes until Gmail recognizes its
        // per-mailbox message id.
        const candidates = transaction.connectionId
          ? connections.filter(({ id }) => id === transaction.connectionId)
          : connections;
        if (candidates.length === 0) throw new Error("Originating Gmail connection not found");

        let message: Awaited<ReturnType<typeof listRecentRawGmailMessages>>[number] | undefined;
        let matchedConnectionId: string | null = null;
        let lastFetchError: unknown = null;
        for (const connection of candidates) {
          try {
            const authed = await authenticate(connection.id);
            if (!authed) throw new Error("not_connected");
            if (!hasGmailReadScope(authed.conn.scope)) throw new Error("gmail_scope_missing");
            const [candidate] = await listRecentRawGmailMessages(authed.gmail, {
              messageIds: [transaction.messageId],
            });
            if (!candidate) throw new Error("Raw Gmail message not found");
            message = candidate;
            matchedConnectionId = connection.id;
            break;
          } catch (error) {
            lastFetchError = error;
          }
        }
        if (!message || !matchedConnectionId) {
          throw lastFetchError ?? new Error("Raw Gmail message not found");
        }

        const result = await processRawGmailMessage(prisma, {
          userId,
          message,
          mode: "reprocess",
          connectionId: matchedConnectionId,
        });
        purchaseActions[result.purchaseAction]++;

        if (result.parserError) {
          failed++;
          errors.push({ messageId: transaction.messageId, error: result.parserError });
        } else {
          succeeded++;
        }
      } catch (error) {
        failed++;
        errors.push({
          messageId: transaction.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    // Gmail may refresh credentials in any mailbox. A rejected authentication
    // must not prevent another mailbox's refreshed token from being flushed.
    await Promise.allSettled([...authByConnection.values()].map(async (pending) => {
      const authed = await pending;
      if (authed) await authed.flushTokens();
    }));
  }

  const nextProcessedOffset = offset + processed;
  const hasMore = nextProcessedOffset < totalCount;

  return NextResponse.json({
    ok: true,
    totalCount,
    processed,
    succeeded,
    failed,
    offset,
    batchSize,
    hasMore,
    nextOffset: hasMore ? nextProcessedOffset : null,
    errors: errors.slice(0, 10),
    progress: totalCount === 0
      ? 100
      : Math.min(100, Math.round((nextProcessedOffset / totalCount) * 100)),
    purchasesCreated: purchaseActions.created,
    purchasesUpdated: purchaseActions.updated,
    purchasesLinked: purchaseActions.linked,
    purchasesDeleted: purchaseActions.deleted,
    purchasesUnlinked: purchaseActions.unlinked,
  });
}
