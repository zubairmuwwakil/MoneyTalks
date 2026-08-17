import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { parsePurchaseFromRawGmailMessage } from "@/lib/domain/receipts/gmailPurchaseParser";
import { storeReceiptAttachment } from "@/lib/domain/receipts/receiptAttachmentStorage";
import { getAuthedImap } from "@/lib/services/imapClient";
import type { Prisma } from "@prisma/client";
import crypto from "crypto";
import { applyCapAccrual } from "@/lib/spine/cap-usage";
import { ensureOwnerStateRecord } from "@/lib/domain/ownerState";
import { findMatchingPurchase } from "@/lib/domain/spine/purchaseMerge";

type TrackingHit = { trackingNumber: string; carrier?: string };

function bufferToBase64Url(buf: Buffer) {
  const b64 = buf.toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

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

function guessSuggestionType(merchant: string, subject?: string | null) {
  const s = (subject ?? "").toLowerCase();
  const m = merchant.toLowerCase();

  if (s.includes("bill") || s.includes("statement") || s.includes("invoice")) return "BILL";
  if (m.includes("netflix") || m.includes("spotify") || s.includes("subscription") || s.includes("renewal")) return "SUBSCRIPTION";
  return "RETURN";
}

function hashSnippet(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function detectSubscriptionItem(subject: string | null, decoded: string) {
  const s = (subject ?? "").toLowerCase();
  const body = decoded.toLowerCase();
  const trialHints = /trial|free trial|trial ends|trial period/.test(s + " " + body);
  const renewalHints = /renew|renews|upcoming charge|subscription|recurring|will be charged/.test(s + " " + body);

  if (trialHints) return "TRIAL" as const;
  if (renewalHints) return "RENEWAL" as const;
  return "RENEWAL" as const;
}

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const days = Number(body?.days ?? 90);
  const max = Number(body?.max ?? 200);

  const authedImap = await getAuthedImap(userId);
  if (!authedImap) return NextResponse.json({ error: "IMAP not connected; add credentials at /api/imap/credentials" }, { status: 400 });
  const scanMode = authedImap.conn.scanMode ?? "ALL";

  let already = 0;
  let parsed = 0;
  let transactionsUpserted = 0;
  let suggestionsCreated = 0;
  let fetched = 0;

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (Number.isFinite(days) ? days : 90));

  try {
    const messages: { uid: number; raw: Buffer; subject?: string | null; from?: string | null; internalDate?: Date | null; messageId: string }[] = [];
    for await (const msg of authedImap.client.fetch({ since }, { uid: true, envelope: true, internalDate: true, source: true })) {
      if (messages.length >= Math.min(Number.isFinite(max) ? max : 200, 500)) break;
      if (!msg.source) continue;
      const messageId = msg.envelope?.messageId ?? `uid-${msg.uid}`;
      const from = msg.envelope?.from?.[0]?.address ?? null;
      const subject = msg.envelope?.subject ?? null;
      messages.push({ uid: msg.uid, raw: msg.source as Buffer, subject, from, internalDate: msg.internalDate ? new Date(msg.internalDate) : null, messageId });
    }

    fetched = messages.length;

    for (const msg of messages) {
      let tx = await prisma.emailTransaction.findUnique({
        where: { userId_provider_messageId: { userId, provider: "GMAIL", messageId: msg.messageId } },
      });
      let purchase: Awaited<ReturnType<typeof parsePurchaseFromRawGmailMessage>> | null = null;
      const decoded = msg.raw.toString("utf8");
      let trackingHits: TrackingHit[] = [];

      if (!tx) {
        trackingHits = detectTrackingNumbers(decoded);

        let parserError: string | null = null;
        try {
          purchase = await parsePurchaseFromRawGmailMessage({ messageId: msg.messageId, raw: bufferToBase64Url(msg.raw) });
          parsed++;
        } catch (error) {
          parserError = error instanceof Error ? error.message : String(error);
          console.error(`Parser error for message ${msg.messageId}:`, parserError);
          purchase = {
            messageId: msg.messageId,
            merchant: "Parse Failed",
            rawSource: "text",
            fromEmail: msg.from ?? undefined,
            subject: msg.subject ?? undefined,
            purchasedAt: msg.internalDate ?? undefined,
            orderId: undefined,
            totalCents: undefined,
            currency: "CAD",
            items: undefined,
          };
        }

        tx = await prisma.emailTransaction.upsert({
          where: { userId_provider_messageId: { userId, provider: "GMAIL", messageId: msg.messageId } },
          create: {
            userId,
            provider: "GMAIL",
            messageId: msg.messageId,
            merchant: purchase!.merchant,
            fromEmail: purchase!.fromEmail ?? null,
            subject: purchase!.subject ?? null,
            purchasedAt: purchase!.purchasedAt ?? msg.internalDate ?? null,
            orderId: purchase!.orderId ?? null,
            totalCents: purchase!.totalCents ?? null,
            currency: (purchase!.currency ?? "CAD").toUpperCase(),
            items: purchase!.items ?? undefined,
            rawSource: purchase!.rawSource,
            parserError,
          },
          update: {
            merchant: purchase!.merchant,
            fromEmail: purchase!.fromEmail ?? null,
            subject: purchase!.subject ?? null,
            purchasedAt: purchase!.purchasedAt ?? msg.internalDate ?? null,
            orderId: purchase!.orderId ?? null,
            totalCents: purchase!.totalCents ?? null,
            currency: (purchase!.currency ?? "CAD").toUpperCase(),
            items: purchase!.items ?? undefined,
            rawSource: purchase!.rawSource,
            parserError,
          },
        });

        const attachments = (purchase as unknown as { attachments?: { filename: string; mimetype?: string; content: Buffer }[] }).attachments;
        if (attachments && attachments.length > 0) {
          for (const attachment of attachments) {
            if (attachment.mimetype && (attachment.mimetype.startsWith("image/") || attachment.mimetype === "application/pdf")) {
              const storagePath = await storeReceiptAttachment({
                userId,
                scopeId: tx.id,
                filename: attachment.filename,
                content: attachment.content,
                contentType: attachment.mimetype,
              });
              await prisma.receiptDocument.create({
                data: {
                  userId,
                  emailTransactionId: tx.id,
                  filename: attachment.filename,
                  contentType: attachment.mimetype,
                  storagePath,
                  sizeBytes: attachment.content.length,
                },
              });
            }
          }
        }

        transactionsUpserted++;
      } else {
        already++;
      }

      if (tx) {
        // Resolve the canonical purchase: previously linked observation first,
        // then this source's own key, then a cross-source match, else create.
        let purchase = tx.purchaseId
          ? await prisma.purchase.findUnique({ where: { id: tx.purchaseId } })
          : await prisma.purchase.findUnique({
              where: { userId_sourceEmailId: { userId, sourceEmailId: msg.messageId } },
            });

        if (purchase && purchase.source === "GMAIL") {
          purchase = await prisma.purchase.update({
            where: { id: purchase.id },
            data: {
              merchant: tx.merchant,
              totalCents: tx.totalCents ?? null,
              currency: (tx.currency ?? "CAD").toUpperCase(),
              purchasedAt: tx.purchasedAt ?? msg.internalDate ?? new Date(),
              orderNumber: tx.orderId ?? null,
            },
          });
        } else if (!purchase) {
          const observedAt = tx.purchasedAt ?? msg.internalDate ?? new Date();
          const match = tx.totalCents != null
            ? await findMatchingPurchase(prisma, {
                userId,
                amountMinor: tx.totalCents,
                observedAt,
                currency: tx.currency,
                merchantCandidates: [tx.merchant],
                incomingSource: "GMAIL",
              })
            : null;

          if (match?.confidence === "exact") {
            // Same real purchase, first seen by Wallet — enrich, don't duplicate.
            purchase = await prisma.purchase.update({
              where: { id: match.purchase.id },
              data: { orderNumber: match.purchase.orderNumber ?? tx.orderId ?? undefined },
            });
          } else {
            purchase = await prisma.purchase.create({
              data: {
                userId,
                merchant: tx.merchant,
                totalCents: tx.totalCents ?? null,
                currency: (tx.currency ?? "CAD").toUpperCase(),
                purchasedAt: observedAt,
                orderNumber: tx.orderId ?? null,
                paymentMethod: null,
                source: "GMAIL",
                sourceEmailId: msg.messageId,
                possibleDuplicateOfId: match?.purchase.id ?? null,
              },
            });
          }
        }

        if (tx.purchaseId !== purchase.id) {
          await prisma.emailTransaction.update({
            where: { id: tx.id },
            data: { purchaseId: purchase.id },
          });
        }

        // Email purchases only accrue once a card and category have been
        // resolved. Unknown classifications deliberately remain unaccrued.
        const resolvedCardId = purchase.paymentMethod;
        const resolvedCategory = purchase.category;
        const resolvedAmountMinor = purchase.totalCents;
        if (resolvedCardId && resolvedCategory && resolvedAmountMinor != null) {
          await prisma.$transaction(async (tx) => {
            const ownerState = await ensureOwnerStateRecord(tx, userId);
            if (!ownerState) return;
            await applyCapAccrual(tx, {
              sourceKey: `purchase:${purchase.id}`,
              userId,
              cardId: resolvedCardId,
              category: resolvedCategory,
              merchantBrand: purchase.merchant,
              amountMinor: resolvedAmountMinor,
              currency: purchase.currency,
              occurredAt: purchase.purchasedAt,
            }, ownerState.stateData);
          });
        }

        if (Array.isArray(tx.items)) {
          await prisma.purchaseItem.deleteMany({ where: { purchaseId: purchase.id } });
          const items = (tx.items as Array<{ name?: string; quantity?: number; price?: number }>).map((it) => ({
            purchaseId: purchase.id,
            title: String(it.name ?? "Item"),
            qty: typeof it.quantity === "number" ? Math.max(1, Math.round(it.quantity)) : null,
            priceCents: typeof it.price === "number" ? Math.round(it.price * 100) : null,
            currency: (tx.currency ?? "CAD").toUpperCase(),
          }));
          if (items.length > 0) {
            await prisma.purchaseItem.createMany({ data: items });
          }
        }

        const docs = await prisma.receiptDocument.findMany({
          where: { emailTransactionId: tx.id },
          select: { storagePath: true, contentType: true },
        });

        if (docs.length > 0) {
          await prisma.purchaseAttachment.createMany({
            data: docs.map((doc) => ({
              purchaseId: purchase.id,
              storageKey: doc.storagePath,
              mime: doc.contentType ?? null,
              sha256: null,
              sourceEmailId: msg.messageId,
            })),
            skipDuplicates: true,
          });
        }
      }

      const suggestionType = tx ? guessSuggestionType(tx.merchant, tx.subject) : null;

      const existingSuggestion = await prisma.automationSuggestion.findUnique({
        where: { userId_primaryMessageId: { userId, primaryMessageId: msg.messageId } },
      });

      const allowSuggestion = (() => {
        if (!suggestionType) return false;
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
        if (type === "SUBSCRIPTION") {
          const rd = new Date(detectedISO + "T00:00:00.000Z");
          rd.setUTCDate(rd.getUTCDate() + 30);
          draft.cadence = "MONTHLY";
          draft.renewalDate = rd.toISOString().slice(0, 10);
        }
        if (type === "BILL") {
          const due = new Date(detectedISO + "T00:00:00.000Z");
          due.setUTCDate(due.getUTCDate() + 7);
          draft.dueDayOfMonth = due.getUTCDate();
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
            currency: tx.currency ?? "CAD",
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
        if (!suggestionType) return false;
        if (scanMode === "ALL") return true;
        if (scanMode === "SUBSCRIPTIONS_ONLY") return suggestionType === "SUBSCRIPTION";
        if (scanMode === "RECEIPTS_ONLY") return suggestionType === "BILL";
        return false;
      })();

      if (tx && suggestionType && allowDetected) {
        const detectedDate = tx.purchasedAt ?? new Date();
        const snippetSource = `${tx.subject ?? ""}\n${decoded.slice(0, 400)}`;
        const snippetHash = hashSnippet(snippetSource);

        let detectedType: "TRIAL" | "RENEWAL" | "BILL" | null = null;
        if (suggestionType === "SUBSCRIPTION") {
          detectedType = detectSubscriptionItem(tx.subject, decoded);
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
                currency: (tx.currency ?? "CAD").toUpperCase(),
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
  } finally {
    await prisma.emailConnection.updateMany({
      where: { userId },
      data: { lastScanAt: new Date() },
    });
    await authedImap.client.logout().catch(() => {});
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
