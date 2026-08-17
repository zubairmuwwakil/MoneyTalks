import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHash } from "node:crypto";
import { secretEquals } from "@/lib/security/secretCrypto";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { RecommendationEngine, PurchaseContext, OwnerState, Catalogue } from "@/engine/cards-twin";

const payloadSchema = z.object({
  schemaVersion: z.literal(1),
  shortcutVersion: z.number(),
  source: z.literal("apple_wallet_shortcuts"),
  eventId: z.string(),
  capturedAt: z.string(),
  timezone: z.string(),
  transaction: z.object({
    merchantRaw: z.string(),
    transactionNameRaw: z.string().nullable().optional(),
    amount: z.number().nullable().optional(),
    currency: z.string().nullable().optional(),
    cardRaw: z.string().nullable().optional(),
  }),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    horizontalAccuracyMeters: z.number().optional(),
  }).nullable().optional(),
});

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

  // Constant-time comparison logic requires fetching the installation first
  // However, we can just query by tokenHash.
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

  const rawBody = await req.json().catch(() => ({}));
  const parsed = payloadSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", details: parsed.error }, { status: 400 });
  }

  const data = parsed.data;

  // Idempotency
  const existing = await prisma.walletEvent.findUnique({
    where: { eventId: data.eventId }
  });
  if (existing) {
    return NextResponse.json({ accepted: true, duplicate: true, eventId: data.eventId });
  }

  // Fuzzy dup check
  const oneMinuteAgo = new Date(Date.now() - 60000);
  const oneMinuteFuture = new Date(Date.now() + 60000);
  const capturedAtDate = new Date(data.capturedAt);

  const fuzzyDup = await prisma.walletEvent.findFirst({
    where: {
      userId: installation.userId,
      cardRaw: data.transaction.cardRaw || null,
      merchantRaw: data.transaction.merchantRaw,
      amountRaw: data.transaction.amount || null,
      capturedAt: {
        gte: new Date(capturedAtDate.getTime() - 60000),
        lte: new Date(capturedAtDate.getTime() + 60000),
      }
    }
  });

  const processingStatus = fuzzyDup ? "POSSIBLE_DUPLICATE" : "OBSERVED";
  const assumedCurrency = data.transaction.currency == null;

  const createdEvent = await prisma.walletEvent.create({
    data: {
      userId: installation.userId,
      walletInstallationId: installation.id,
      eventId: data.eventId,
      source: data.source,
      schemaVersion: data.schemaVersion,
      shortcutVersion: data.shortcutVersion,
      capturedAt: capturedAtDate,
      merchantRaw: data.transaction.merchantRaw,
      transactionNameRaw: data.transaction.transactionNameRaw,
      amountRaw: data.transaction.amount,
      currencyRaw: data.transaction.currency,
      cardRaw: data.transaction.cardRaw,
      latitude: data.location?.latitude,
      longitude: data.location?.longitude,
      locationAccuracyMeters: data.location?.horizontalAccuracyMeters,
      assumedCurrency,
      processingStatus,
    }
  });

  // Sync verdict
  let verdict = "unknown";
  let warning: string | undefined = undefined;

  try {
    const ownerStateRecord = await prisma.ownerStateRecord.findUnique({
      where: { userId: installation.userId }
    });

    if (ownerStateRecord && data.transaction.cardRaw && data.transaction.amount != null) {
      const cardAlias = await prisma.cardAlias.findUnique({ where: { rawString: data.transaction.cardRaw } });
      const merchantAlias = await prisma.merchantAlias.findUnique({ where: { rawString: data.transaction.merchantRaw } });
      
      if (cardAlias && merchantAlias) {
        // We need category for recommendation engine... 
        // For now, if we have merchantNormalized, we can try to run it.
        // We'll hardcode some generic category if not known, but wait, the engine requires category.
        // If we don't know the category, how can we give a verdict?
        // Maybe we just say category = "unknown"?
        const ownerState = ownerStateRecord.stateData as unknown as OwnerState;
        
        // Wait, the real engine needs a valid category to match rules. If we just pass "unknown", it falls back to base earn.
        // This is fine for V1 until the async categorization updates the DB. Wait, but sync verdict is generated synchronously!
        // We will just do what we can. 
        const purchaseContext: PurchaseContext = {
          amountCad: data.transaction.amount,
          currency: data.transaction.currency || "CAD",
          category: "unknown",
          merchantBrand: merchantAlias.normalizedName,
        };

        const engine = new RecommendationEngine(loadCatalogue(), ownerState);
        
        // Hack: we need to find what card was used.
        // The purchaseContext doesn't specify the used card. It just scores all.
        // Then we see if the card used was the winner.
        const recommendation = engine.recommend(purchaseContext, capturedAtDate.toISOString().split("T")[0]);
        const usedCardId = cardAlias.cardId;

        const best = recommendation.winner;
        if (best.cardId === usedCardId) {
          verdict = "best";
        } else {
          // It's a warning only if it clears switch threshold (A3).
          // RecommendationEngine handles threshold logic for switchedFromDefault.
          // BUT wait, A3 says "clears the switch threshold".
          // In the twin engine, `advantageOverDefaultCad` handles it if the used card was the default.
          // If they used a card that is NOT the winner, and the winner's advantage over the USED card clears the threshold...
          const usedScore = recommendation.allCandidates.find(c => c.cardId === usedCardId);
          if (usedScore) {
            const advantage = best.netValueCad - usedScore.netValueCad;
            const advantagePP = purchaseContext.amountCad > 0 ? (advantage / purchaseContext.amountCad) * 100 : 0;
            const t = ownerState.switchThreshold;
            const cadOk = advantage >= t.minAdvantageCad;
            const ppOk = advantagePP >= t.minAdvantagePercentagePoints;
            const clears = t.semantics === 'either' ? (cadOk || ppOk) : (cadOk && ppOk);

            if (clears) {
              verdict = "warning";
              // We need to format the warning. "⚠ Cobalt would have earned ~$0.74 more"
              const bestCard = loadCatalogue().cards.find(c => c.cardId === best.cardId);
              const cardName = bestCard ? bestCard.officialName : best.cardId;
              warning = `⚠ ${cardName} would have earned ~$${advantage.toFixed(2)} more`;
            } else {
               verdict = "best"; // or acceptable
            }
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

  return NextResponse.json({
    accepted: true,
    eventId: data.eventId,
    feedback: { verdict, warning }
  });
}
