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
