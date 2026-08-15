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

  const direct = latest(rates, from, to);
  if (direct) return Math.round(amountMinor * direct.rate);

  const inverse = latest(rates, to, from);
  if (inverse) return Math.round(amountMinor / inverse.rate);

  throw new MissingFxRateError(from, to);
}
