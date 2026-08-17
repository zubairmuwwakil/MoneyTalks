"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { mapRows, parseCsv, type ColumnMapping } from "@/engine/csv";
import {
  coverageForLines,
  PROPOSED_STATUSES,
  reconcileStatementLines,
  type CapturedPurchase,
  type ReconciledStatementLine,
} from "@/engine/statement-reconciliation";
import { cardCatalogue } from "@/lib/contracts/cardCatalogue";
import { applyUserDecision, purchaseIdsToReconcile, statementLineHash, parseCandidateId } from "@/lib/domain/spine/statementLines";
import { walletAmountMinor } from "@/lib/domain/wallet/amount";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { csvMappingInput } from "@/lib/validation/csv-import";
import { IMPORT_LIMITS } from "@/lib/validation/investments";

export type StatementReviewLine = Pick<
  ReconciledStatementLine,
  "id" | "date" | "amountMinor" | "description" | "status" | "matchedMerchant" | "observedMinor"
>;

export type StatementPreview = {
  ok: true;
  matchedLines: number;
  proposedLines: number;
  eligibleLines: number;
  percentage: number;
  ambiguousLines: number;
  /** Every line that still wants a human: unmatched, ambiguous, proposed, rejected. */
  reviewLines: StatementReviewLine[];
};
export type StatementPreviewFailure = { ok: false; error: string };

const cardInput = z.object({
  cardId: z.string().min(1),
  contractCardId: z.string().min(1).max(100),
});

const manualPurchaseInput = z.object({
  cardId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountMinor: z.number().int().positive(),
  description: z.string().trim().min(1).max(200),
});

function dayBounds(date: string) {
  const midnight = new Date(`${date}T00:00:00.000Z`);
  return { start: midnight, end: new Date(midnight.getTime() + 86_400_000) };
}

function dateWindow(dates: string[]) {
  const sorted = dates.slice().sort();
  const first = Date.parse(`${sorted[0]}T00:00:00Z`) - 3 * 86_400_000;
  const last = Date.parse(`${sorted[sorted.length - 1]}T00:00:00Z`) + 3 * 86_400_000;
  return { gte: new Date(first), lte: new Date(last) };
}

/**
 * A statement posts in the card's billing currency, so a foreign-currency
 * observation is a different number for the same purchase — USD 45.00 against a
 * CAD 58.50 line is FX, not a tip, and the merchant gate cannot tell them apart
 * because the merchant genuinely matches. Such a capture must not be a candidate
 * at all. The storage default mirrors walletNormalization and purchaseMerge.
 */
function billedIn(currency: string | null | undefined, cardCurrency: string): boolean {
  return (currency?.trim() || "CAD").toUpperCase() === cardCurrency.toUpperCase();
}

async function ownedCard(userId: string, cardId: string) {
  return prisma.creditCard.findFirst({ where: { id: cardId, userId }, select: { id: true, currency: true, contractCardId: true } });
}

/** Parses, matches, and returns the upload in one response; no statement data is written to disk or the database. */
export async function previewStatement(formData: FormData): Promise<StatementPreview | StatementPreviewFailure> {
  const userId = await requireUserId();
  const cardParsed = cardInput.safeParse({ cardId: formData.get("cardId"), contractCardId: formData.get("contractCardId") });
  if (!cardParsed.success) return { ok: false, error: "Choose a card and its Wallet capture identity." };
  if (!cardCatalogue.cards.some((card) => card.cardId === cardParsed.data.contractCardId)) {
    return { ok: false, error: "Unknown Wallet capture identity." };
  }
  const card = await ownedCard(userId, cardParsed.data.cardId);
  if (!card) return { ok: false, error: "Card not found." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a CSV file first." };
  if (file.size > IMPORT_LIMITS.fileBytes) return { ok: false, error: "CSV file is too large (maximum 5 MB)." };

  const mappingParsed = csvMappingInput.safeParse({
    dateCol: formData.get("dateCol"), amountCol: formData.get("amountCol"), descriptionCol: formData.get("descriptionCol"),
    dateFormat: formData.get("dateFormat"), negate: formData.get("negate") ?? "false", hasHeader: formData.get("hasHeader") ?? "false",
  });
  if (!mappingParsed.success) return { ok: false, error: "Check the column mapping." };

  let mapped;
  try {
    mapped = mapRows(parseCsv(await file.text()), mappingParsed.data as ColumnMapping);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not parse CSV." };
  }
  const validRows = mapped.filter((row): row is Extract<typeof row, { date: string }> => "date" in row);
  if (validRows.length === 0) return { ok: false, error: "No valid statement lines found. Check the mapping and date format." };

  // Canonical statement convention: positive amounts are purchases. A checkbox
  // handles issuers that export purchases as negatives; credits remain negative.
  const statementLines = validRows.map((row, index) => ({ ...row, id: `statement-${index}` }));
  const dates = statementLines.map((line) => line.date);
  const window = dateWindow(dates);

  const cardAliases = await prisma.cardAlias.findMany({
    where: { userId, cardId: cardParsed.data.contractCardId }, select: { rawString: true },
  });
  const rawCardNames = cardAliases.map((alias) => alias.rawString);
  const [purchases, walletEvents] = await Promise.all([
    prisma.purchase.findMany({
      where: { userId, paymentMethod: cardParsed.data.contractCardId, totalCents: { not: null }, purchasedAt: window },
      select: { id: true, sourceEventId: true, merchant: true, totalCents: true, purchasedAt: true, currency: true },
    }),
    rawCardNames.length === 0
      ? Promise.resolve([])
      : prisma.walletEvent.findMany({
          where: { userId, cardRaw: { in: rawCardNames }, amountRaw: { not: null }, capturedAt: window },
          select: { id: true, eventId: true, merchantRaw: true, amountRaw: true, capturedAt: true, currencyRaw: true },
        }),
  ]);
  const promotedEventIds = new Set(purchases.flatMap((purchase) => purchase.sourceEventId ? [purchase.sourceEventId] : []));
  const candidateRawMerchants = walletEvents.map((event) => event.merchantRaw).filter((value): value is string => Boolean(value));
  const aliasRows = await prisma.merchantAlias.findMany({
    where: { rawString: { in: [...candidateRawMerchants, ...statementLines.map((line) => line.description)] } },
    select: { rawString: true, normalizedName: true },
  });
  const aliases = new Map(aliasRows.map((alias) => [alias.rawString.toLocaleLowerCase(), alias.normalizedName]));
  const candidates: CapturedPurchase[] = [
    ...purchases
      .filter((purchase) => billedIn(purchase.currency, card.currency))
      .map((purchase) => ({
        id: `purchase:${purchase.id}`, date: purchase.purchasedAt.toISOString().slice(0, 10), amountMinor: purchase.totalCents!,
        merchant: purchase.merchant, source: "purchase" as const,
      })),
    ...walletEvents
      .filter((event) => !promotedEventIds.has(event.eventId) && billedIn(event.currencyRaw, card.currency))
      .map((event) => ({
        id: `wallet:${event.id}`, date: event.capturedAt.toISOString().slice(0, 10), amountMinor: walletAmountMinor(event.amountRaw)!,
        merchant: event.merchantRaw ?? "", source: "wallet" as const,
      })),
  ];
  const computed = reconcileStatementLines(statementLines, candidates, aliases);
  const lineHashes = computed.map((line) =>
    statementLineHash({ cardId: card.id, date: line.date, description: line.description, amountMinor: line.amountMinor }),
  );
  const persistedStatus = new Map(
    (
      await prisma.statementLine.findMany({
        where: { userId, lineHash: { in: lineHashes } },
        select: { lineHash: true, status: true },
      })
    ).map((row) => [row.lineHash, row.status]),
  );
  // Re-uploading a statement must not take back a tolerance decision the user
  // already made, so a stored confirm or reject outranks a fresh tolerant guess.
  const reconciled: ReconciledStatementLine[] = computed.map((line, index) => {
    const status = applyUserDecision(line.status, persistedStatus.get(lineHashes[index]));
    if (status === line.status) return line;
    return status === "rejected"
      ? { ...line, status, matchedCandidateId: undefined, matchedMerchant: undefined, observedMinor: undefined }
      : { ...line, status };
  });
  const coverage = coverageForLines(reconciled);

  // A re-upload replaces the compact result for each covered month. Because raw
  // lines are intentionally ephemeral, reports are snapshots, not an event log.
  const byMonth = new Map<string, ReconciledStatementLine[]>();
  for (const line of reconciled) {
    const month = line.date.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), line]);
  }
  // Statement lines are the third observation source: persist each line and
  // link matches to the canonical purchase. Un-promoted wallet matches
  // resolve through the event's purchase link once it exists.
  const parsedMatches = reconciled.map((line) => parseCandidateId(line.matchedCandidateId));
  const matchedWalletEventIds = parsedMatches.flatMap((m) => (m.walletEventId ? [m.walletEventId] : []));
  const walletEventPurchase = new Map(
    (matchedWalletEventIds.length > 0
      ? await prisma.walletEvent.findMany({
          where: { id: { in: matchedWalletEventIds }, userId },
          select: { id: true, purchaseId: true },
        })
      : []
    ).map((event) => [event.id, event.purchaseId]),
  );
  const resolvedLines = reconciled.map((line, index) => {
    const match = parsedMatches[index];
    return {
      line,
      lineHash: lineHashes[index],
      walletEventId: match.walletEventId,
      purchaseId: match.purchaseId ?? (match.walletEventId ? walletEventPurchase.get(match.walletEventId) ?? null : null),
    };
  });
  const matchedPurchaseIds = purchaseIdsToReconcile(resolvedLines.map(({ line, purchaseId }) => ({ status: line.status, purchaseId })));

  await prisma.$transaction([
    prisma.creditCard.update({ where: { id: card.id }, data: { contractCardId: cardParsed.data.contractCardId } }),
    ...[...byMonth.entries()].map(([month, lines]) => {
      const result = coverageForLines(lines);
      return prisma.coverageReport.upsert({
        where: { cardId_month: { cardId: card.id, month } },
        update: { matchedLines: result.matchedLines, eligibleLines: result.eligibleLines },
        create: { userId, cardId: card.id, month, matchedLines: result.matchedLines, eligibleLines: result.eligibleLines },
      });
    }),
    ...(matchedPurchaseIds.length > 0
      ? [
          prisma.walletEvent.updateMany({
            where: { userId, purchaseId: { in: matchedPurchaseIds }, processingStatus: "NORMALIZED" },
            data: { processingStatus: "RECONCILED" },
          }),
        ]
      : []),
  ]);

  // Line upserts run in chunks so a 500-line statement never becomes one
  // giant transaction (Neon-friendly); each upsert is idempotent by hash.
  const lineUpserts = resolvedLines.map(({ line, lineHash, purchaseId, walletEventId }) => {
      const shared = {
        date: new Date(`${line.date}T00:00:00.000Z`),
        description: line.description,
        amountMinor: line.amountMinor,
        status: line.status,
        purchaseId,
        walletEventId,
      };
      return prisma.statementLine.upsert({
        where: { userId_lineHash: { userId, lineHash } },
        create: { userId, cardId: card.id, lineHash, ...shared },
        update: shared,
      });
  });
  for (let i = 0; i < lineUpserts.length; i += 100) {
    await prisma.$transaction(lineUpserts.slice(i, i + 100));
  }
  revalidatePath("/cards");
  revalidatePath("/cards/reconcile");

  return {
    ok: true,
    ...coverage,
    ambiguousLines: reconciled.filter((line) => line.status === "ambiguous").length,
    reviewLines: reconciled
      .filter((line) => line.status !== "matched" && line.status !== "excluded")
      .map(({ id, date, amountMinor, description, status, matchedMerchant, observedMinor }) => ({
        id, date, amountMinor, description, status, matchedMerchant, observedMinor,
      })),
  };
}

export async function addStatementLineAsPurchase(input: unknown): Promise<{ ok: true; alreadyExists: boolean } | StatementPreviewFailure> {
  const userId = await requireUserId();
  const parsed = manualPurchaseInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That statement line is invalid." };
  const card = await ownedCard(userId, parsed.data.cardId);
  if (!card?.contractCardId) return { ok: false, error: "Reconcile this card first so its Wallet identity is linked." };
  const { start, end } = dayBounds(parsed.data.date);
  const existing = await prisma.purchase.findFirst({
    where: {
      userId, source: "MANUAL", paymentMethod: card.contractCardId, merchant: parsed.data.description,
      totalCents: parsed.data.amountMinor, purchasedAt: { gte: start, lt: end },
    },
    select: { id: true },
  });
  if (existing) return { ok: true, alreadyExists: true };
  const created = await prisma.purchase.create({
    data: {
      userId, source: "MANUAL", merchant: parsed.data.description, totalCents: parsed.data.amountMinor,
      currency: card.currency, purchasedAt: start, paymentMethod: card.contractCardId,
    },
  });
  // Link the persisted statement line to the purchase it just became.
  await prisma.statementLine.updateMany({
    where: {
      userId,
      lineHash: statementLineHash({
        cardId: card.id,
        date: parsed.data.date,
        description: parsed.data.description,
        amountMinor: parsed.data.amountMinor,
      }),
    },
    data: { purchaseId: created.id, status: "matched" },
  });
  revalidatePath("/purchases");
  revalidatePath("/cards/reconcile");
  return { ok: true, alreadyExists: false };
}

const proposedDecisionInput = manualPurchaseInput.extend({
  decision: z.enum(["confirm", "reject"]),
});

/**
 * Settles a proposed match — a tipped amount or a settled pre-auth hold.
 * Confirming promotes the line to a real match and lets it flip the wallet event
 * to RECONCILED, the step `previewStatement` deliberately withholds. Rejecting
 * drops the candidate link and returns the line to the add-as-purchase flow.
 * Either way the stored status outranks the engine on the next upload, so the
 * decision sticks.
 */
export async function resolveProposedMatch(
  input: unknown,
): Promise<{ ok: true; status: "matched" | "rejected" } | StatementPreviewFailure> {
  const userId = await requireUserId();
  const parsed = proposedDecisionInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That statement line is invalid." };
  const card = await ownedCard(userId, parsed.data.cardId);
  if (!card) return { ok: false, error: "Card not found." };

  const lineHash = statementLineHash({
    cardId: card.id,
    date: parsed.data.date,
    description: parsed.data.description,
    amountMinor: parsed.data.amountMinor,
  });
  const line = await prisma.statementLine.findUnique({
    where: { userId_lineHash: { userId, lineHash } },
    select: { id: true, status: true, purchaseId: true, walletEventId: true },
  });
  if (!line) return { ok: false, error: "Reconcile this statement again before resolving the match." };
  if (!PROPOSED_STATUSES.some((status) => status === line.status)) {
    return { ok: false, error: "That line is no longer awaiting a decision." };
  }

  if (parsed.data.decision === "reject") {
    await prisma.statementLine.update({
      where: { id: line.id },
      data: { status: "rejected", purchaseId: null, walletEventId: null },
    });
    revalidatePath("/cards/reconcile");
    return { ok: true, status: "rejected" };
  }

  // An un-promoted wallet event has no purchase yet; the line keeps its event
  // link and inherits the purchase when that event promotes.
  const purchaseId =
    line.purchaseId ??
    (line.walletEventId
      ? (await prisma.walletEvent.findFirst({
          where: { id: line.walletEventId, userId },
          select: { purchaseId: true },
        }))?.purchaseId ?? null
      : null);

  await prisma.$transaction([
    prisma.statementLine.update({ where: { id: line.id }, data: { status: "matched", purchaseId } }),
    ...(purchaseId
      ? [
          prisma.walletEvent.updateMany({
            where: { userId, purchaseId, processingStatus: "NORMALIZED" },
            data: { processingStatus: "RECONCILED" },
          }),
        ]
      : []),
  ]);
  revalidatePath("/cards");
  revalidatePath("/cards/reconcile");
  return { ok: true, status: "matched" };
}
