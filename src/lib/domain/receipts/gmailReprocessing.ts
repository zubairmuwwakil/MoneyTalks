import type { PrismaClient } from "@prisma/client";

import {
  processRawGmailMessage,
  type GmailMessageProcessingMode,
  type GmailPurchaseAction,
} from "./gmailReceiptProcessing";
import { getAuthedGmail, listUserConnections } from "@/lib/services/gmailClient";
import { hasGmailReadScope, listRecentRawGmailMessages } from "@/lib/services/gmailScanSource";

export type StoredGmailMessage = {
  id: string;
  messageId: string;
  connectionId: string | null;
};

export class GmailReprocessUnavailableError extends Error {}

export type GmailReprocessBatchResult = {
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ messageId: string; error: string }>;
  purchaseActions: Record<GmailPurchaseAction, number>;
};

/**
 * Re-fetch and replay a bounded set of one owner's stored Gmail messages.
 *
 * Authentication is cached per mailbox because legacy rows have no
 * connectionId and must be tried against each mailbox. Token flushes live in
 * the same finally block for every caller so a failed replay cannot strand a
 * refreshed credential.
 */
export async function reprocessStoredGmailMessages(
  db: PrismaClient,
  params: {
    userId: string;
    transactions: readonly StoredGmailMessage[];
    mode: Extract<GmailMessageProcessingMode, "reprocess" | "facts-reprocess">;
  },
): Promise<GmailReprocessBatchResult> {
  const connections = await listUserConnections(params.userId);
  if (connections.length === 0) {
    throw new GmailReprocessUnavailableError("Gmail not connected. Connect it in Settings → Automation.");
  }

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
    for (const transaction of params.transactions) {
      processed += 1;

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

        const result = await processRawGmailMessage(db, {
          userId: params.userId,
          message,
          mode: params.mode,
          connectionId: matchedConnectionId,
        });
        purchaseActions[result.purchaseAction] += 1;

        if (result.parserError) {
          failed += 1;
          errors.push({ messageId: transaction.messageId, error: result.parserError });
        } else {
          succeeded += 1;
        }
      } catch (error) {
        failed += 1;
        errors.push({
          messageId: transaction.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await Promise.allSettled([...authByConnection.values()].map(async (pending) => {
      const authed = await pending;
      if (authed) await authed.flushTokens();
    }));
  }

  return { processed, succeeded, failed, errors, purchaseActions };
}
