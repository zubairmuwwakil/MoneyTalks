import { convertMinor, findFxRate, MissingFxRateError, type FxRateInput } from "@/engine/fx";
import type { Currency } from "@/engine/money";

export type PurchaseImpactRangeKey = "4W" | "12W" | "52W";

export interface PurchaseImpactInput {
  date: string;
  merchant: string;
  totalMinor: number | null;
  currency: string | null;
  refundMinor?: number | null;
  refundCurrency?: string | null;
  refundDate?: string | null;
  refunds?: Array<{
    date: string;
    amountMinor: number;
    currency: string | null;
  }>;
}

export interface PurchaseImpactPoint {
  weekStart: string;
  purchaseMinor: number;
  refundMinor: number;
}

export interface PurchaseImpactRange {
  points: PurchaseImpactPoint[];
  totalMinor: number;
  refundMinor: number;
  netMinor: number;
  previousMinor: number;
  deltaPct: number | null;
  drivers: Array<{ merchant: string; amountMinor: number }>;
  excludedCount: number;
  missingAmountCount: number;
  comparisonExcludedCount: number;
  comparisonMissingAmountCount: number;
  fxOldestAsOf: string | null;
  fxLatestAsOf: string | null;
}

export interface PurchaseImpactView {
  displayCurrency: "CAD";
  ranges: Record<PurchaseImpactRangeKey, PurchaseImpactRange>;
}

const RANGE_WEEKS: Record<PurchaseImpactRangeKey, number> = {
  "4W": 4,
  "12W": 12,
  "52W": 52,
};

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const SUPPORTED_CURRENCIES = new Set<Currency>(["CAD", "USD", "JMD"]);

function isoDayMs(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function mondayStartMs(date: string): number {
  const ms = isoDayMs(date);
  if (ms === null) throw new RangeError(`asOf must be an ISO date, got ${date}`);
  const day = new Date(ms).getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  return ms - offset * DAY_MS;
}

function currency(value: string | null | undefined): Currency | null {
  return value && SUPPORTED_CURRENCIES.has(value as Currency) ? (value as Currency) : null;
}

function convertOrNull(
  amountMinor: number,
  sourceCurrency: string | null | undefined,
  rates: FxRateInput[],
): { amountMinor: number; fxAsOf: string | null } | null {
  const from = currency(sourceCurrency);
  if (!from) return null;
  try {
    const converted = convertMinor(amountMinor, from, "CAD", rates);
    return {
      amountMinor: converted,
      fxAsOf: from === "CAD" ? null : (findFxRate(rates, from, "CAD")?.rate.asOf ?? null),
    };
  } catch (error) {
    if (error instanceof MissingFxRateError) return null;
    throw error;
  }
}

export function buildPurchaseImpact(
  purchases: PurchaseImpactInput[],
  rates: FxRateInput[],
  asOf: string,
): PurchaseImpactView {
  const currentWeekStart = mondayStartMs(asOf);
  const asOfMs = isoDayMs(asOf);
  if (asOfMs === null) throw new RangeError(`asOf must be an ISO date, got ${asOf}`);
  const asOfEnd = asOfMs + DAY_MS;

  const ranges = Object.fromEntries(
    (Object.entries(RANGE_WEEKS) as Array<[PurchaseImpactRangeKey, number]>).map(([key, weeks]) => {
      const currentStart = currentWeekStart - (weeks - 1) * WEEK_MS;
      const previousStart = currentStart - weeks * WEEK_MS;
      const byWeek = new Map<number, PurchaseImpactPoint>();
      const merchantTotals = new Map<string, number>();
      let totalMinor = 0;
      let refundMinor = 0;
      let previousMinor = 0;
      let excludedCount = 0;
      let missingAmountCount = 0;
      let comparisonExcludedCount = 0;
      let comparisonMissingAmountCount = 0;
      const usedFxDates = new Set<string>();

      for (let index = 0; index < weeks; index += 1) {
        const weekMs = currentStart + index * WEEK_MS;
        byWeek.set(weekMs, { weekStart: toIso(weekMs), purchaseMinor: 0, refundMinor: 0 });
      }

      for (const purchase of purchases) {
        const purchaseMs = isoDayMs(purchase.date);
        if (purchaseMs !== null && purchaseMs >= previousStart && purchaseMs < asOfEnd) {
          if (purchase.totalMinor === null) {
            if (purchaseMs >= currentStart) missingAmountCount += 1;
            else comparisonMissingAmountCount += 1;
          } else {
            const conversion = convertOrNull(purchase.totalMinor, purchase.currency, rates);
            if (conversion === null) {
              if (purchaseMs >= currentStart) excludedCount += 1;
              else comparisonExcludedCount += 1;
            } else if (purchaseMs >= currentStart) {
              const weekMs = mondayStartMs(purchase.date);
              const point = byWeek.get(weekMs);
              if (point) point.purchaseMinor += conversion.amountMinor;
              totalMinor += conversion.amountMinor;
              merchantTotals.set(
                purchase.merchant,
                (merchantTotals.get(purchase.merchant) ?? 0) + conversion.amountMinor,
              );
              if (conversion.fxAsOf) usedFxDates.add(conversion.fxAsOf);
            } else {
              previousMinor += conversion.amountMinor;
              if (conversion.fxAsOf) usedFxDates.add(conversion.fxAsOf);
            }
          }
        }

        const refundEvents = purchase.refunds ?? (
          purchase.refundMinor && purchase.refundMinor > 0
            ? [{
                date: purchase.refundDate ?? purchase.date,
                amountMinor: purchase.refundMinor,
                currency: purchase.refundCurrency ?? purchase.currency,
              }]
            : []
        );
        for (const refund of refundEvents) {
          if (refund.amountMinor <= 0) continue;
          const refundDate = refund.date;
          const refundMs = isoDayMs(refundDate);
          if (refundMs !== null && refundMs >= currentStart && refundMs < asOfEnd) {
            const conversion = convertOrNull(
              refund.amountMinor,
              refund.currency,
              rates,
            );
            if (conversion === null) {
              excludedCount += 1;
            } else {
              const weekMs = mondayStartMs(refundDate);
              const point = byWeek.get(weekMs);
              if (point) point.refundMinor += conversion.amountMinor;
              refundMinor += conversion.amountMinor;
              if (conversion.fxAsOf) usedFxDates.add(conversion.fxAsOf);
            }
          }
        }
      }

      const drivers = [...merchantTotals.entries()]
        .map(([merchant, amountMinor]) => ({ merchant, amountMinor }))
        .sort((a, b) => b.amountMinor - a.amountMinor || a.merchant.localeCompare(b.merchant))
        .slice(0, 3);

      return [
        key,
        {
          points: [...byWeek.values()],
          totalMinor,
          refundMinor,
          netMinor: totalMinor - refundMinor,
          previousMinor,
          deltaPct:
            previousMinor === 0 ||
            excludedCount > 0 ||
            missingAmountCount > 0 ||
            comparisonExcludedCount > 0 ||
            comparisonMissingAmountCount > 0
              ? null
              : Math.round(((totalMinor - previousMinor) / previousMinor) * 100),
          drivers,
          excludedCount,
          missingAmountCount,
          comparisonExcludedCount,
          comparisonMissingAmountCount,
          fxOldestAsOf: [...usedFxDates].sort()[0] ?? null,
          fxLatestAsOf: [...usedFxDates].sort().at(-1) ?? null,
        },
      ];
    }),
  ) as unknown as Record<PurchaseImpactRangeKey, PurchaseImpactRange>;

  return { displayCurrency: "CAD", ranges };
}
