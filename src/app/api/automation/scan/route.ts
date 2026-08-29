import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { classifyReceiptEmail, hasPurchaseEvidence } from "@/lib/domain/receipts/receiptEvidence";
import { processRawGmailMessage } from "@/lib/domain/receipts/gmailReceiptProcessing";
import { getAuthedGmail, listUserConnections } from "@/lib/services/gmailClient";
import { hasGmailReadScope, listRecentRawGmailMessages } from "@/lib/services/gmailScanSource";
import type { Prisma } from "@prisma/client";
import crypto from "crypto";
import { normalizeCurrencyCode } from "@/lib/utils/currency";

type TrackingHit = { trackingNumber: string; carrier?: string };

function detectTrackingNumbers(text: string): TrackingHit[] {
  const hits = new Map<string, TrackingHit>();
  const lines = text.split(/\r?\n/).slice(0, 400);
  const carriers = [
    { carrier: "UPS", regex: /\b1Z[0-9A-Z]{16}\b/gi },
    { carrier: "FedEx", regex: /\b\d{12,15}\b/g },
    { carrier: "USPS", regex: /\b9\d{15,21}\b/g },
    { carrier: "DHL", regex: /\b[A-Z]{3}\d{9}\b/gi },
  ];

  for (const line of lines) {
    const lower = line.toLowerCase();
    const relevant = /track|ups|fedex|usps|dhl|canada post|parcel/.test(lower);
    if (!relevant) continue;

    for (const pattern of carriers) {
      const matches = line.match(pattern.regex) ?? [];
      for (const m of matches) {
        const key = m.trim();
        if (!hits.has(key)) hits.set(key, { trackingNumber: key, carrier: pattern.carrier });
      }
    }

    if (/tracking/.test(lower)) {
      const generic = [...line.matchAll(/[A-Z0-9]{10,24}/g)];
      for (const g of generic) {
        const val = g[0];
        if (val.length < 12) continue;
        if (!hits.has(val)) hits.set(val, { trackingNumber: val });
      }
    }
  }

  return Array.from(hits.values());
}

function hashSnippet(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function detectSubscriptionItem(subject: string | null, decoded: string) {
  const s = (subject ?? "").toLowerCase();
  const body = decoded.toLowerCase();
  const trialHints = /trial|free trial|trial ends|trial period/.test(s + " " + body);
  const renewalHints = /renew|renews|upcoming charge|subscription|recurring|will be charged/.test(s + " " + body);

  if (trialHints) return "TRIAL" as const;
  if (renewalHints) return "RENEWAL" as const;
  return null;
}

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const days = Number(body?.days ?? 90);
  const max = Number(body?.max ?? 200);

  // Task 6 fans this out across every connection. Until then, resolve the
  // owner's mailbox explicitly rather than handing getAuthedGmail a userId:
  // it now takes a connection id, and both are plain strings, so the swap
  // would compile cleanly and simply report "not connected" forever.
  const [connection] = await listUserConnections(userId);
  const authed = connection ? await getAuthedGmail(connection.id) : null;
  if (!authed) {
    return NextResponse.json({ error: "Gmail not connected. Connect it in Settings → Automation." }, { status: 400 });
  }
  if (!hasGmailReadScope(authed.conn.scope)) {
    return NextResponse.json(
      { error: "Google didn't grant Gmail access. Reconnect and tick the Gmail checkbox on the consent screen." },
      { status: 400 }
    );
  }
  const { gmail, flushTokens } = authed;
  const scanMode = authed.conn.scanMode ?? "ALL";

  let already = 0;
  let parsed = 0;
  let transactionsUpserted = 0;
  let suggestionsCreated = 0;
  let fetched = 0;

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (Number.isFinite(days) ? days : 90));

  let scanError: string | null = null;

  try {
    const messages = await listRecentRawGmailMessages(gmail, {
      since,
      max: Math.min(Number.isFinite(max) ? max : 200, 500),
    });

    fetched = messages.length;

    for (const msg of messages) {
      const processedMessage = await processRawGmailMessage(prisma, {
        userId,
        message: msg,
        mode: "scan",
      });
      const { parsedPurchase, parserError } = processedMessage;
      const tx = processedMessage.transaction;

      if (parserError) {
        console.error(`Parser error for message ${msg.messageId}:`, parserError);
      } else {
        parsed++;
      }

      // The decoded body — never the raw MIME, whose base64 and
      // quoted-printable bytes defeat every one of these regexes.
      const body = parsedPurchase.textBody ?? "";
      const trackingHits: TrackingHit[] = detectTrackingNumbers(body);

      if (processedMessage.transactionAction === "created") {
        transactionsUpserted++;
      } else if (processedMessage.transactionAction === "skipped") {
        already++;
      }

      // Null means "no purchase signal at all" — the honest answer for
      // marketing mail, which previously fell through to RETURN.
      const suggestionType = tx ? classifyReceiptEmail(tx.subject, body) : null;
      // A suggestion needs something concrete behind it: money, an order id,
      // or a tracking number.
      const actionable = hasPurchaseEvidence(parsedPurchase) || trackingHits.length > 0;

      const existingSuggestion = await prisma.automationSuggestion.findUnique({
        where: { userId_primaryMessageId: { userId, primaryMessageId: msg.messageId } },
      });

      const allowSuggestion = (() => {
        if (!suggestionType || !actionable) return false;
        if (scanMode === "ALL") return true;
        if (scanMode === "SUBSCRIPTIONS_ONLY") return suggestionType === "SUBSCRIPTION";
        if (scanMode === "RECEIPTS_ONLY") return suggestionType === "RETURN" || suggestionType === "BILL";
        if (scanMode === "SHIPPING_ONLY") return suggestionType === "RETURN" && trackingHits.length > 0;
        return false;
      })();

      if (!existingSuggestion && tx && allowSuggestion) {
        if (!suggestionType) {
          continue;
        }
        const type = suggestionType;

        const detected = tx.purchasedAt ?? new Date();
        const detectedISO = detected.toISOString().slice(0, 10);

        const draft: Record<string, unknown> = {};
        if (type === "RETURN") {
          const purchaseDate = detectedISO;
          const returnWindowDays = 30;
          const rb = new Date(purchaseDate + "T00:00:00.000Z");
          rb.setUTCDate(rb.getUTCDate() + returnWindowDays);
          draft.purchaseDate = purchaseDate;
          draft.returnWindowDays = returnWindowDays;
          draft.returnBy = rb.toISOString().slice(0, 10);
          const hit = trackingHits[0];
          if (hit) {
            draft.trackingNumber = hit.trackingNumber;
            if (hit.carrier) draft.carrier = hit.carrier;
          }
        }
        if (type === "BILL") {
          draft.autopay = false;
        }

        await prisma.automationSuggestion.create({
          data: {
            userId,
            provider: "GMAIL",
            primaryMessageId: msg.messageId,
            type,
            status: "NEW",
            merchant: tx.merchant,
            amountCents: tx.totalCents ?? null,
            currency: normalizeCurrencyCode(tx.currency),
            detectedDate: detected,
            confidence: "MEDIUM",
            reasons: [`Built from transaction (${tx.rawSource})`],
            messageIds: [msg.messageId],
            draft: draft as Prisma.InputJsonValue,
          },
        });

        suggestionsCreated++;
      }

      const allowDetected = (() => {
        if (!suggestionType || !actionable) return false;
        if (scanMode === "ALL") return true;
        if (scanMode === "SUBSCRIPTIONS_ONLY") return suggestionType === "SUBSCRIPTION";
        if (scanMode === "RECEIPTS_ONLY") return suggestionType === "BILL";
        return false;
      })();

      if (tx && suggestionType && allowDetected) {
        const detectedDate = tx.purchasedAt ?? new Date();
        const snippetSource = `${tx.subject ?? ""}\n${body.slice(0, 400)}`;
        const snippetHash = hashSnippet(snippetSource);

        let detectedType: "TRIAL" | "RENEWAL" | "BILL" | null = null;
        if (suggestionType === "SUBSCRIPTION") {
          detectedType = detectSubscriptionItem(tx.subject, body);
        } else if (suggestionType === "BILL") {
          detectedType = "BILL";
        }

        if (detectedType) {
          const existingDetected = await prisma.detectedItem.findFirst({
            where: {
              userId,
              type: detectedType,
              rawSnippetHash: snippetHash,
              date: detectedDate,
            },
            select: { id: true },
          });

          if (!existingDetected) {
            await prisma.detectedItem.create({
              data: {
                userId,
                type: detectedType,
                merchant: tx.merchant,
                amountCents: tx.totalCents ?? null,
                currency: normalizeCurrencyCode(tx.currency),
                date: detectedDate,
                confidence: "MEDIUM",
                sourceEmailId: msg.messageId,
                rawSnippetHash: snippetHash,
                status: "NEW",
              },
            });
          }
        }
      }
    }
  } catch (error) {
    // Surface the real upstream failure (e.g. "Gmail API ... is disabled")
    // instead of an opaque 500 that reads as an empty scan.
    scanError = error instanceof Error ? error.message : String(error);
    console.error(`[scan] failed for ${userId}:`, scanError);
  } finally {
    // lastScanAt records that a scan COMPLETED, not that one was attempted.
    // Stamping it unconditionally made a scan that threw indistinguishable
    // from one that ran and found nothing — which is exactly how a failed
    // scan on 2026-08-17 read as an empty inbox for twelve days, with the
    // timestamp lending it false credibility. A monitoring signal that cannot
    // tell "broken" from "quiet" is worse than none, because it is believed.
    if (!scanError) {
      await prisma.emailConnection.updateMany({
        where: { userId },
        data: { lastScanAt: new Date() },
      });
    }
    // Refreshed tokens must be durably stored before the function returns.
    // This runs even on failure: a token refreshed mid-scan is still valid,
    // and dropping it would silently disconnect the owner.
    await flushTokens();
  }

  if (scanError) {
    return NextResponse.json({ error: `Scan failed: ${scanError}` }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    importedEmails: transactionsUpserted,
    skipped: already,
    suggestionsCreated,
    parsed,
    fetched,
  });
}
