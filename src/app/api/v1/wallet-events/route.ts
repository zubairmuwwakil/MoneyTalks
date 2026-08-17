import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHash } from "node:crypto";
import { secretEquals } from "@/lib/security/secretCrypto";
import * as fs from "fs";
import * as path from "path";
import { RecommendationEngine, PurchaseContext, OwnerState, Catalogue } from "@/engine/cards-twin";
import { parseWalletCapturePayload } from "@/lib/domain/wallet/capturePayload";
import { ensureOwnerStateRecord } from "@/lib/domain/ownerState";

function loadCatalogue(): Catalogue {
  const p = path.resolve(process.cwd(), "contracts/card-catalogue.json");
  return JSON.parse(fs.readFileSync(p, "utf-8")) as Catalogue;
}

export async function POST(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const token = authHeader.substring(7);
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const installation = await prisma.walletInstallation.findUnique({
    where: { tokenHash },
  });

  if (!installation || installation.revokedAt) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Double check with constant-time compare just in case, though DB lookup on unique constraint is already exact.
  if (!secretEquals(installation.tokenHash, tokenHash)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const rawBody = await req.json().catch(() => null);
  if (rawBody == null) {
    return NextResponse.json({ error: "invalid payload", final: true }, { status: 400 });
  }
  const parsed = parseWalletCapturePayload(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid payload", final: true, details: parsed.error }, { status: 400 });
  }

  const data = parsed.data;

  // Idempotency
  const existing = await prisma.walletEvent.findUnique({
    where: { eventId: data.eventId }
  });
  if (existing) {
    return NextResponse.json({ accepted: true, duplicate: true, final: true, eventId: data.eventId });
  }

  // An unparseable device timestamp must not cost us the transaction; the
  // original string survives in capturedAtRaw / rawPayload.
  const capturedAt = data.capturedAt ?? new Date();

  // Fuzzy dup check
  const fuzzyDup = await prisma.walletEvent.findFirst({
    where: {
      userId: installation.userId,
      cardRaw: data.cardRaw,
      merchantRaw: data.merchantRaw,
      amountRaw: data.amount,
      capturedAt: {
        gte: new Date(capturedAt.getTime() - 60000),
        lte: new Date(capturedAt.getTime() + 60000),
      }
    }
  });

  const processingStatus = fuzzyDup ? "POSSIBLE_DUPLICATE" : "OBSERVED";
  const assumedCurrency = data.currency == null;

  // Resolve identities up front when the alias tables already know them, so
  // the stored record is complete at capture time. The async pipeline still
  // owns processingStatus transitions.
  const merchantAlias = data.merchantRaw
    ? await prisma.merchantAlias.findUnique({ where: { rawString: data.merchantRaw } })
    : null;
  const cardAlias = data.cardRaw
    ? await prisma.cardAlias.findUnique({
        where: { userId_rawString: { userId: installation.userId, rawString: data.cardRaw } },
      })
    : null;

  const createdEvent = await prisma.walletEvent.create({
    data: {
      userId: installation.userId,
      walletInstallationId: installation.id,
      eventId: data.eventId,
      source: data.source,
      schemaVersion: data.schemaVersion,
      shortcutVersion: data.shortcutVersion,
      capturedAt,
      capturedAtRaw: data.capturedAtRaw,
      capturedTimezone: data.capturedTimezone,
      merchantRaw: data.merchantRaw,
      transactionNameRaw: data.transactionNameRaw,
      amountRaw: data.amount,
      currencyRaw: data.currency,
      cardRaw: data.cardRaw,
      merchantNormalized: merchantAlias?.normalizedName ?? null,
      resolvedCardId: cardAlias?.cardId ?? null,
      latitude: data.latitude,
      longitude: data.longitude,
      locationAccuracyMeters: data.locationAccuracyMeters,
      rawPayload: rawBody,
      assumedCurrency,
      processingStatus,
    }
  });

  // Sync verdict
  let verdict = "unknown";
  let warning: string | undefined = undefined;
  const amountNumber = data.amount != null ? Number(data.amount) : null;

  try {
    const ownerStateRecord = await ensureOwnerStateRecord(prisma, installation.userId);

    if (ownerStateRecord && cardAlias && merchantAlias && amountNumber != null) {
      // Category is unknown at capture time; the engine falls back to base
      // earn until async categorization improves the record.
      const ownerState = ownerStateRecord.stateData as unknown as OwnerState;
      const purchaseContext: PurchaseContext = {
        amountCad: amountNumber,
        currency: data.currency || "CAD",
        category: "unknown",
        merchantBrand: merchantAlias.normalizedName,
      };

      const engine = new RecommendationEngine(loadCatalogue(), ownerState);
      const recommendation = engine.recommend(purchaseContext, capturedAt.toISOString().split("T")[0]);
      const usedCardId = cardAlias.cardId;

      const best = recommendation.winner;
      if (best.cardId === usedCardId) {
        verdict = "best";
      } else {
        // A warning only if the winner's advantage over the used card clears
        // the switch threshold (A3).
        const usedScore = recommendation.allCandidates.find(c => c.cardId === usedCardId);
        if (usedScore) {
          const advantage = best.netValueCad - usedScore.netValueCad;
          const advantagePP = amountNumber > 0 ? (advantage / amountNumber) * 100 : 0;
          const t = ownerState.switchThreshold;
          const cadOk = advantage >= t.minAdvantageCad;
          const ppOk = advantagePP >= t.minAdvantagePercentagePoints;
          const clears = t.semantics === 'either' ? (cadOk || ppOk) : (cadOk && ppOk);

          if (clears) {
            verdict = "warning";
            const bestCard = loadCatalogue().cards.find(c => c.cardId === best.cardId);
            const cardName = bestCard ? bestCard.officialName : best.cardId;
            warning = `⚠ ${cardName} would have earned ~$${advantage.toFixed(2)} more`;
          } else {
            verdict = "best";
          }
        }
      }
    }
  } catch (e) {
    console.error("Error computing verdict", e);
  }

  await prisma.walletEvent.update({
    where: { id: createdEvent.id },
    data: { feedbackVerdict: verdict, feedbackWarning: warning ?? null },
  });

  // `final: true` marks every definitive JSON verdict (2xx and 4xx) so the
  // Shortcut can use one flat check to delete its outbox file; transient
  // failures (network, 5xx, platform errors) never produce this shape.
  // `notification` is the ready-to-show text, present only when there is one.
  return NextResponse.json({
    accepted: true,
    eventId: data.eventId,
    final: true,
    feedback: { verdict, warning },
    ...(warning ? { notification: warning } : {}),
  });
}
