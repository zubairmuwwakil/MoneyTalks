import type { Currency } from "./money";

export interface FxRateInput {
  base: Currency;
  quote: Currency;
  rate: number;
  asOf: string; // ISO 8601
}

export class MissingFxRateError extends Error {
  constructor(from: Currency, to: Currency) {
    super(`No FX rate available to convert ${from} to ${to}`);
    this.name = "MissingFxRateError";
  }
}

function latest(rates: FxRateInput[], base: Currency, quote: Currency): FxRateInput | undefined {
  return rates
    .filter((r) => r.base === base && r.quote === quote)
    .sort((a, b) => (a.asOf < b.asOf ? 1 : -1))[0];
}

/**
 * The rate `convertMinor` would apply, exposed so callers that must record
 * provenance stamp exactly the rate that was used rather than re-deriving it.
 * `inverted` means the stored rate runs quote->base and was divided, not
 * multiplied.
 */
export function findFxRate(
  rates: FxRateInput[],
  from: Currency,
  to: Currency,
): { rate: FxRateInput; inverted: boolean } | undefined {
  const direct = latest(rates, from, to);
  if (direct) return { rate: direct, inverted: false };

  const inverse = latest(rates, to, from);
  if (inverse) return { rate: inverse, inverted: true };

  return undefined;
}

function validateRate(rate: number): void {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError(`rate must be a finite positive number, got ${rate}`);
  }
}

function roundSafe(value: number): number {
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded)) {
    throw new RangeError(`converted amount must be a safe integer, got ${rounded}`);
  }
  return rounded;
}

export function convertMinor(
  amountMinor: number,
  from: Currency,
  to: Currency,
  rates: FxRateInput[],
): number {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(`amountMinor must be a safe integer, got ${amountMinor}`);
  }
  if (from === to) return amountMinor;

  const found = findFxRate(rates, from, to);
  if (!found) throw new MissingFxRateError(from, to);

  validateRate(found.rate.rate);
  return roundSafe(found.inverted ? amountMinor / found.rate.rate : amountMinor * found.rate.rate);
}
