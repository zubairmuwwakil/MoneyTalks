"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { mapRows, parseCsv, type ColumnMapping } from "@/engine/csv";
import {
  coverageForLines,
  reconcileStatementLines,
  type CapturedPurchase,
  type ReconciledStatementLine,
} from "@/engine/statement-reconciliation";
import { cardCatalogue } from "@/lib/contracts/cardCatalogue";
import { statementLineHash, parseCandidateId } from "@/lib/domain/spine/statementLines";
import { walletAmountMinor } from "@/lib/domain/wallet/amount";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { csvMappingInput } from "@/lib/validation/csv-import";
import { IMPORT_LIMITS } from "@/lib/validation/investments";

export type StatementPreview = {
  ok: true;
  matchedLines: number;
  eligibleLines: number;
  percentage: number;
  ambiguousLines: number;
  unmatchedLines: Array<Pick<ReconciledStatementLine, "id" | "date" | "amountMinor" | "description" | "status">>;
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
      select: { id: true, sourceEventId: true, merchant: true, totalCents: true, purchasedAt: true },
    }),
    rawCardNames.length === 0
      ? Promise.resolve([])
      : prisma.walletEvent.findMany({
          where: { userId, cardRaw: { in: rawCardNames }, amountRaw: { not: null }, capturedAt: window },
          select: { id: true, eventId: true, merchantRaw: true, amountRaw: true, capturedAt: true },
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
    ...purchases.map((purchase) => ({
      id: `purchase:${purchase.id}`, date: purchase.purchasedAt.toISOString().slice(0, 10), amountMinor: purchase.totalCents!,
      merchant: purchase.merchant, source: "purchase" as const,
    })),
    ...walletEvents
      .filter((event) => !promotedEventIds.has(event.eventId))
      .map((event) => ({
        id: `wallet:${event.id}`, date: event.capturedAt.toISOString().slice(0, 10), amountMinor: walletAmountMinor(event.amountRaw)!,
        merchant: event.merchantRaw ?? "", source: "wallet" as const,
      })),
  ];
  const reconciled = reconcileStatementLines(statementLines, candidates, aliases);
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
  const matchedPurchaseIds = [
    ...new Set(
      parsedMatches.flatMap((m) => {
        const resolved = m.purchaseId ?? (m.walletEventId ? walletEventPurchase.get(m.walletEventId) : null);
        return resolved ? [resolved] : [];
      }),
    ),
  ];

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
  const lineUpserts = reconciled.map((line, index) => {
      const match = parsedMatches[index];
      const purchaseId =
        match.purchaseId ?? (match.walletEventId ? walletEventPurchase.get(match.walletEventId) ?? null : null);
      const lineHash = statementLineHash({
        cardId: card.id,
        date: line.date,
        description: line.description,
        amountMinor: line.amountMinor,
      });
      const shared = {
        date: new Date(`${line.date}T00:00:00.000Z`),
        description: line.description,
        amountMinor: line.amountMinor,
        status: line.status,
        purchaseId,
        walletEventId: match.walletEventId,
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
    unmatchedLines: reconciled
      .filter((line) => line.status === "unmatched" || line.status === "ambiguous")
      .map(({ id, date, amountMinor, description, status }) => ({ id, date, amountMinor, description, status })),
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
