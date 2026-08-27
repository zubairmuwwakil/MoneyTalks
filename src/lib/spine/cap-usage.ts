import { RuleMatcher } from "@/engine/cards-twin/RuleMatcher";
import type { Cap, Catalogue, OwnerState, PurchaseContext } from "@/engine/cards-twin/models";
import { cardCatalogue } from "@/lib/contracts/cardCatalogue";
import { normalizeCurrencyCode } from "@/lib/utils/currency";
import { convertMinor, findFxRate, MissingFxRateError, type FxRateInput } from "@/engine/fx";
import type { Currency } from "@/engine/money";

export const LEDGER_TIME_ZONE = "America/Toronto";
const USD_PER_CAD = 0.73;

type LedgerTransaction = {
  // Optional: absent in unit fixtures, present on a real Prisma client. When
  // absent no rates are available, so foreign amounts fail closed.
  fxRate?: {
    findMany(args: unknown): Promise<{ base: string; quote: string; rate: unknown; asOf: Date }[]>;
  };
  capAccrual: {
    findUnique(args: unknown): Promise<{ id: string; userId: string; cardId: string; capId: string; periodKey: string; usedMinor: number; reversedAt: Date | null } | null>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
    delete(args: unknown): Promise<unknown>;
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
  /** Provenance: what was observed, before any conversion. */
  sourceAmountMinor: number;
  sourceCurrency: string;
  /**
   * Effective multiplier applied to reach CAD, or null for native CAD. Stored
   * so a ledger entry can be audited without re-deriving which rate was live.
   */
  fxRate: number | null;
  fxRateAsOf: Date | null;
};

export type CapAccrualSkip =
  | "not-accruable"
  | "unknown-currency"
  | "missing-fx-rate";

export type CapAccrualOutcome =
  | { accrual: ResolvedCapAccrual; skipped?: undefined }
  | { accrual?: undefined; skipped: CapAccrualSkip };

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
  if (cap.period === "calendarQuarter") return `${year}-Q${Math.ceil(month / 3)}`;
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

/**
 * Resolve the RuleMatcher result the checkout engine would use, naming the
 * reason when nothing accrues.
 *
 * Foreign spend is converted into the CAD ledger using the user's own stored
 * FX rates. Dropping it (the previous behaviour) under-counted the ledger, so
 * the engine could recommend a card whose cap was nearer exhaustion than the
 * ledger believed. Converting without a rate would be the opposite sin, so a
 * missing rate still fails closed.
 */
export function resolveCapAccrualOutcome(
  source: CapUsageSource,
  ownerStateData: unknown,
  catalogue = cardCatalogue as unknown as Catalogue,
  rates: FxRateInput[] = [],
): CapAccrualOutcome {
  if (!Number.isSafeInteger(source.amountMinor) || source.amountMinor <= 0) return { skipped: "not-accruable" };

  const currency = normalizeCurrencyCode(source.currency);
  // An unidentified currency cannot be converted; it can only be guessed at.
  if (!currency) return { skipped: "unknown-currency" };

  let amountMinorCad = source.amountMinor;
  let fxRate: number | null = null;
  let fxRateAsOf: Date | null = null;

  if (currency !== "CAD") {
    // The engine's Currency union is the twin's contract scope; the ledger
    // accepts any ISO code the user actually holds a rate for.
    const from = currency as Currency;
    const found = findFxRate(rates, from, "CAD");
    if (!found) return { skipped: "missing-fx-rate" };

    try {
      amountMinorCad = convertMinor(source.amountMinor, from, "CAD", rates);
    } catch (error) {
      // A missing or corrupt rate must never silently become a CAD figure.
      if (error instanceof MissingFxRateError || error instanceof RangeError) return { skipped: "missing-fx-rate" };
      throw error;
    }

    fxRate = found.inverted ? 1 / found.rate.rate : found.rate.rate;
    fxRateAsOf = new Date(found.rate.asOf);
  }

  const ownerState = ownerStateData as OwnerState;
  const card = catalogue.cards.find((candidate) => candidate.cardId === source.cardId);
  if (!card || !ownerState?.cardStates) return { skipped: "not-accruable" };

  const cardState = ownerState.cardStates[source.cardId] ?? {};
  const purchase: PurchaseContext = {
    amountCad: amountMinorCad / 100,
    currency: "CAD",
    category: source.category || "unknown",
    merchantBrand: source.merchantBrand ?? undefined,
  };
  const resolution = RuleMatcher.resolve(card, purchase, ownerState, asOfDate(source.occurredAt));
  if (resolution.type !== "applied" || !resolution.rule.capId) return { skipped: "not-accruable" };

  const cap = card.caps.find((candidate) => candidate.capId === resolution.rule.capId);
  if (!cap) return { skipped: "not-accruable" }; // Contract violation: never manufacture an undeclared cap.
  const periodKey = capPeriodKey(cap, cardState, source.occurredAt);
  if (!periodKey) return { skipped: "not-accruable" }; // An unresolved account-year anchor cannot be guessed.

  // `spendUsdEquivalent` is always a CAD -> USD estimate, unconditionally, regardless of the
  // card's own billing currency (mirrors Scorer's USD-cap fallback: amountCad * 0.73 when no
  // explicit usdEquivalent was supplied). `spendNative` is measured in the CARD's OWN
  // billingCurrency, not CAD unconditionally — for a USD-billing card this is the same CAD -> USD
  // fallback as above; for a CAD-billing card (every card until the multi-market import) it's the
  // identity. Storing the raw CAD minor amount here for a USD-billing card would silently fill a
  // USD-denominated cap using CAD numbers, understating (at today's rate) how much room is left.
  const usedMinor = cap.measure === "spendUsdEquivalent"
    ? Math.round(amountMinorCad * USD_PER_CAD)
    : card.billingCurrency === "USD"
      ? Math.round(amountMinorCad * USD_PER_CAD)
      : amountMinorCad;

  return {
    accrual: {
      sourceKey: source.sourceKey,
      userId: source.userId,
      cardId: source.cardId,
      capId: cap.capId,
      periodKey,
      usedMinor,
      sourceAmountMinor: source.amountMinor,
      sourceCurrency: currency,
      fxRate,
      fxRateAsOf,
    },
  };
}

/** Resolve exactly the RuleMatcher result the checkout engine would use. */
export function resolveCapAccrual(
  source: CapUsageSource,
  ownerStateData: unknown,
  catalogue = cardCatalogue as unknown as Catalogue,
  rates: FxRateInput[] = [],
): ResolvedCapAccrual | null {
  return resolveCapAccrualOutcome(source, ownerStateData, catalogue, rates).accrual ?? null;
}

/** Apply an accrual inside the caller's transaction. The source key is unique. */
export async function applyCapAccrual(tx: LedgerTransaction, source: CapUsageSource, ownerStateData: unknown, catalogue = cardCatalogue as unknown as Catalogue): Promise<ResolvedCapAccrual | null> {
  const currency = normalizeCurrencyCode(source.currency);

  // Only a foreign amount needs rates, so the common CAD path stays query-free.
  let rates: FxRateInput[] = [];
  if (currency && currency !== "CAD" && tx.fxRate) {
    const rows = await tx.fxRate.findMany({ where: { userId: source.userId } });
    rates = rows.map((row) => ({
      base: row.base as Currency,
      quote: row.quote as Currency,
      rate: Number(row.rate),
      asOf: row.asOf.toISOString(),
    }));
  }

  const outcome = resolveCapAccrualOutcome(source, ownerStateData, catalogue, rates);
  if (outcome.skipped) {
    // "not-accruable" is the ordinary case (most spend matches no cap).
    // A currency problem is a data gap and must be observable, not silent.
    if (outcome.skipped !== "not-accruable") {
      console.warn(`[cap-usage] no accrual for ${source.sourceKey}: ${outcome.skipped} (currency=${currency ?? "unknown"})`);
    }
    return null;
  }
  const resolved = outcome.accrual;

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

/**
 * Remove an accrual whose source projection was corrected. Unlike a terminal
 * reversal, deleting the idempotency row deliberately permits later explicit
 * evidence to accrue the canonical purchase again.
 */
export async function removeCapAccrual(tx: LedgerTransaction, sourceKey: string): Promise<boolean> {
  const accrual = await tx.capAccrual.findUnique({ where: { sourceKey } });
  if (!accrual) return false;

  // An already-reversed row contributes nothing to the aggregate, but its
  // idempotency key must still be removed when the canonical projection is
  // being replaced. Otherwise Undo would restore the purchase while
  // applyCapAccrual silently refused to restore its cap usage.
  if (!accrual.reversedAt) {
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
  }
  await tx.capAccrual.delete({ where: { id: accrual.id } });
  return true;
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
