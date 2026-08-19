export type TxTypeName =
  | "CONTRIBUTION"
  | "WITHDRAWAL"
  | "BUY"
  | "SELL"
  | "DIVIDEND"
  | "INTEREST"
  | "FEE";

export interface TxInput {
  type: TxTypeName;
  amountMinor: number;
  date: string; // ISO 8601
}

export interface CurrencyTxInput extends TxInput {
  currency: string;
}

export interface SnapshotInput {
  balanceMinor: number;
  asOf: string; // ISO 8601
}

export interface CurrencySnapshotInput extends SnapshotInput {
  currency: string;
}

export type AccountBalanceWithCurrency =
  | {
      ok: true;
      balanceMinor: number;
      currency: string;
      asOf: string | null;
      source: "snapshot" | "derived";
    }
  | {
      ok: false;
      error: string;
    };

const SIGN: Record<TxTypeName, number> = {
  CONTRIBUTION: 1,
  DIVIDEND: 1,
  INTEREST: 1,
  WITHDRAWAL: -1,
  FEE: -1,
  BUY: 0,
  SELL: 0,
};

export function deriveBalanceMinor(transactions: TxInput[]): number {
  return transactions.reduce((sum, tx) => {
    if (!Number.isSafeInteger(tx.amountMinor)) {
      throw new RangeError(`amountMinor must be a safe integer, got ${tx.amountMinor}`);
    }
    const nextSum = sum + SIGN[tx.type] * tx.amountMinor;
    if (!Number.isSafeInteger(nextSum)) {
      throw new RangeError(`derived balance must be a safe integer, got ${nextSum}`);
    }
    return nextSum;
  }, 0);
}

export function latestSnapshot<T extends SnapshotInput>(snapshots: T[]): T | undefined {
  return [...snapshots].sort((a, b) => (a.asOf < b.asOf ? 1 : a.asOf > b.asOf ? -1 : 0))[0];
}

export function accountBalance(
  transactions: TxInput[],
  snapshots: SnapshotInput[],
): { balanceMinor: number; asOf: string | null; source: "snapshot" | "derived" } {
  const latest = latestSnapshot(snapshots);
  if (latest) {
    if (!Number.isSafeInteger(latest.balanceMinor)) {
      throw new RangeError(`balanceMinor must be a safe integer, got ${latest.balanceMinor}`);
    }
    return { balanceMinor: latest.balanceMinor, asOf: latest.asOf, source: "snapshot" };
  }
  const latestTx = [...transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
  return {
    balanceMinor: deriveBalanceMinor(transactions),
    asOf: latestTx?.date ?? null,
    source: "derived",
  };
}

export function accountBalanceWithCurrency(
  transactions: CurrencyTxInput[],
  snapshots: CurrencySnapshotInput[],
  accountCurrency: string,
): AccountBalanceWithCurrency {
  const latest = latestSnapshot(snapshots);
  if (latest) {
    const balance = accountBalance([], [latest]);
    return { ok: true, ...balance, currency: latest.currency };
  }

  const mismatched = transactions.find((tx) => tx.currency !== accountCurrency);
  if (mismatched) {
    return {
      ok: false,
      error: `Cannot derive ${accountCurrency} balance from ${mismatched.currency} transaction without a balance snapshot`,
    };
  }

  const balance = accountBalance(transactions, []);
  return { ok: true, ...balance, currency: accountCurrency };
}

export function holdingValueMinor(quantity: number, lastPriceMinor: number): number {
  if (!Number.isFinite(quantity)) {
    throw new RangeError(`quantity must be finite, got ${quantity}`);
  }
  if (!Number.isSafeInteger(lastPriceMinor)) {
    throw new RangeError(`lastPriceMinor must be a safe integer, got ${lastPriceMinor}`);
  }
  const valueMinor = Math.round(quantity * lastPriceMinor);
  if (!Number.isSafeInteger(valueMinor)) {
    throw new RangeError(`holding value must be a safe integer, got ${valueMinor}`);
  }
  return valueMinor;
}

/** One holding, as much of it as valuation needs. */
export type HoldingForValuation = {
  symbol: string;
  quantity: number;
  lastPriceMinor: number;
  /** ISO-4217 the price is quoted in, or null for a manually-entered legacy price. */
  priceCurrency: string | null;
};

export type ExcludedHolding = { symbol: string; priceCurrency: string; reason: "currency-mismatch" };

export type HoldingsValuation = {
  /** Total of the holdings that could honestly be added together. */
  valueMinor: number;
  currency: string;
  /** Holdings priced in a currency that is not the account's. Excluded from the
   *  total and returned so the caller is forced to disclose them. */
  excluded: ExcludedHolding[];
  /** Holdings with no recorded price currency, counted in the total under the
   *  account's currency but flagged as an unverified assumption. */
  assumedCurrency: string[];
  /** True when every holding was priced in the account's own currency. */
  complete: boolean;
};

/**
 * Totals an account's holdings, refusing to add prices quoted in different
 * currencies.
 *
 * Previously every holding's price was implicitly the account's currency, which
 * held only while prices were typed in by hand. Sourcing them from a market-data
 * provider breaks it the first time a TSX symbol appears in a USD account: 189.70
 * CAD and 310.03 USD are not addable, and a total that adds them is wrong with no
 * outward sign of being wrong.
 *
 * A mismatch excludes that holding rather than failing the whole account — a user
 * with nine clean holdings and one foreign listing should still see nine — but the
 * exclusions come back with the total so the caller cannot present a partial sum
 * as a complete one.
 *
 * A null price currency is a legacy manually-entered price, whose implicit
 * convention genuinely was "the account's currency". It counts, and is reported in
 * `assumedCurrency` so that assumption is stated rather than buried. Provider-
 * sourced prices are never written without a currency, so null cannot silently
 * mean "the provider did not say".
 */
export function holdingsValuation(
  holdings: HoldingForValuation[],
  accountCurrency: string,
): HoldingsValuation {
  const normalizedAccount = accountCurrency.toUpperCase();
  const excluded: ExcludedHolding[] = [];
  const assumedCurrency: string[] = [];
  let valueMinor = 0;

  for (const holding of holdings) {
    const priceCurrency = holding.priceCurrency?.toUpperCase() ?? null;
    if (priceCurrency !== null && priceCurrency !== normalizedAccount) {
      excluded.push({ symbol: holding.symbol, priceCurrency, reason: "currency-mismatch" });
      continue;
    }
    if (priceCurrency === null) {
      assumedCurrency.push(holding.symbol);
    }
    valueMinor += holdingValueMinor(holding.quantity, holding.lastPriceMinor);
  }

  return {
    valueMinor,
    currency: normalizedAccount,
    excluded,
    assumedCurrency,
    complete: excluded.length === 0,
  };
}
