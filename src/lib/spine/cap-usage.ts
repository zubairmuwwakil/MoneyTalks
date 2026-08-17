import { RuleMatcher } from "@/engine/cards-twin/RuleMatcher";
import type { Cap, Catalogue, OwnerState, PurchaseContext } from "@/engine/cards-twin/models";
import { cardCatalogue } from "@/lib/contracts/cardCatalogue";

export const LEDGER_TIME_ZONE = "America/Toronto";
const USD_PER_CAD = 0.73;

type LedgerTransaction = {
  capAccrual: {
    findUnique(args: unknown): Promise<{ id: string; userId: string; cardId: string; capId: string; periodKey: string; usedMinor: number; reversedAt: Date | null } | null>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  capUsageLedger: {
    upsert(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
};

export type CapUsageSource = {
  sourceKey: string;
  userId: string;
  cardId: string;
  category?: string | null;
  merchantBrand?: string | null;
  amountMinor: number;
  currency?: string | null;
  occurredAt: Date;
};

export type ResolvedCapAccrual = {
  sourceKey: string;
  userId: string;
  cardId: string;
  capId: string;
  periodKey: string;
  usedMinor: number;
};

function datePartsInToronto(asOf: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LEDGER_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(asOf);
  const value = (type: "year" | "month") => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month") };
}

/**
 * Cap reset zones are contract data, but 3d intentionally has one server-side
 * period convention until resetTimeZone is implemented: America/Toronto.
 */
export function capPeriodKey(cap: Pick<Cap, "period" | "anchor">, cardState: { scotiaAccountYearAnchorMonth?: unknown; rogersAccountAnniversaryMonth?: unknown } | undefined, asOf: Date): string | undefined {
  const { year, month } = datePartsInToronto(asOf);
  if (cap.period === "calendarMonth") return `${year}-${String(month).padStart(2, "0")}`;
  if (cap.period === "calendarYear") return String(year);
  if (cap.period !== "accountYear") return undefined;

  const anchorMonth = cap.anchor === "ownerState.scotiaAccountYearAnchorMonth"
    ? cardState?.scotiaAccountYearAnchorMonth
    : cap.anchor === "ownerState.rogersAccountAnniversaryMonth"
      ? cardState?.rogersAccountAnniversaryMonth
      : undefined;
  if (typeof anchorMonth !== "number" || !Number.isInteger(anchorMonth) || anchorMonth < 1 || anchorMonth > 12) return undefined;

  const startYear = month >= anchorMonth ? year : year - 1;
  return `${startYear}-${String(anchorMonth).padStart(2, "0")}`;
}

function asOfDate(asOf: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LEDGER_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(asOf);
  const value = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** Resolve exactly the RuleMatcher result the checkout engine would use. */
export function resolveCapAccrual(source: CapUsageSource, ownerStateData: unknown, catalogue = cardCatalogue as unknown as Catalogue): ResolvedCapAccrual | null {
  if (!Number.isSafeInteger(source.amountMinor) || source.amountMinor <= 0) return null;
  const ownerState = ownerStateData as OwnerState;
  const card = catalogue.cards.find((candidate) => candidate.cardId === source.cardId);
  if (!card || !ownerState?.cardStates) return null;

  const cardState = ownerState.cardStates[source.cardId] ?? {};
  const purchase: PurchaseContext = {
    // The purchase spine stores amountMinor as the CAD amount used by the twin.
    amountCad: source.amountMinor / 100,
    currency: source.currency ?? "CAD",
    category: source.category || "unknown",
    merchantBrand: source.merchantBrand ?? undefined,
  };
  const resolution = RuleMatcher.resolve(card, purchase, ownerState, asOfDate(source.occurredAt));
  if (resolution.type !== "applied" || !resolution.rule.capId) return null;

  const cap = card.caps.find((candidate) => candidate.capId === resolution.rule.capId);
  if (!cap) return null; // Contract violation: never manufacture an undeclared cap.
  const periodKey = capPeriodKey(cap, cardState, source.occurredAt);
  if (!periodKey) return null; // An unresolved account-year anchor cannot be guessed.

  return {
    sourceKey: source.sourceKey,
    userId: source.userId,
    cardId: source.cardId,
    capId: cap.capId,
    periodKey,
    // Matches Scorer's USD-cap fallback: amountCad * 0.73 when no explicit
    // usdEquivalent was supplied by the purchase context.
    usedMinor: cap.measure === "spendUsdEquivalent" ? Math.round(source.amountMinor * USD_PER_CAD) : source.amountMinor,
  };
}

/** Apply an accrual inside the caller's transaction. The source key is unique. */
export async function applyCapAccrual(tx: LedgerTransaction, source: CapUsageSource, ownerStateData: unknown, catalogue = cardCatalogue as unknown as Catalogue): Promise<ResolvedCapAccrual | null> {
  const resolved = resolveCapAccrual(source, ownerStateData, catalogue);
  if (!resolved) return null;

  const existing = await tx.capAccrual.findUnique({ where: { sourceKey: resolved.sourceKey } });
  if (existing) return null;

  // Create the idempotency record first. In this transaction the source key's
  // unique index serializes concurrent reprocessing before the aggregate moves.
  await tx.capAccrual.create({ data: resolved });
  await tx.capUsageLedger.upsert({
    where: {
      userId_cardId_capId_periodKey: {
        userId: resolved.userId,
        cardId: resolved.cardId,
        capId: resolved.capId,
        periodKey: resolved.periodKey,
      },
    },
    create: {
      userId: resolved.userId,
      cardId: resolved.cardId,
      capId: resolved.capId,
      periodKey: resolved.periodKey,
      usedMinor: resolved.usedMinor,
    },
    update: { usedMinor: { increment: resolved.usedMinor } },
  });
  return resolved;
}

/** Reverse only an applied source; repeated reversal requests are a no-op. */
export async function reverseCapAccrual(tx: LedgerTransaction, sourceKey: string, reversedAt = new Date()): Promise<boolean> {
  const accrual = await tx.capAccrual.findUnique({ where: { sourceKey } });
  if (!accrual || accrual.reversedAt) return false;

  await tx.capUsageLedger.update({
    where: {
      userId_cardId_capId_periodKey: {
        userId: accrual.userId,
        cardId: accrual.cardId,
        capId: accrual.capId,
        periodKey: accrual.periodKey,
      },
    },
    data: { usedMinor: { decrement: accrual.usedMinor } },
  });
  await tx.capAccrual.update({ where: { id: accrual.id }, data: { reversedAt } });
  return true;
}
