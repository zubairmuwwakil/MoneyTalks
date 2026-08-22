import {
  accountBalanceWithCurrency,
  holdingsValuation,
  type CurrencySnapshotInput,
  type CurrencyTxInput,
  type TxTypeName,
} from "@/engine/balance";
import { findFxRate, type FxRateInput } from "@/engine/fx";
import type { Currency } from "@/engine/money";

export type AccountHealthIssue = {
  id: string;
  category: "snapshot" | "price" | "fx" | "cash" | "setup";
  severity: "error" | "warning" | "info";
  title: string;
  description: string;
  actionHint?: string;
  affectedSymbols?: string[];
};

export type AccountHoldingInput = {
  id: string;
  symbol: string;
  name: string;
  quantity: number | { toNumber(): number } | string;
  lastPriceMinor: number;
  priceCurrency: string | null;
  priceAsOf: Date | string;
  priceStatus: string | null;
  priceSource?: string | null;
  bookCostMinor?: number | null;
};

export type AccountTransactionInput = {
  id: string;
  type: string;
  amountMinor: number;
  currency: string;
  date: Date | string;
};

export type AccountBalanceSnapshotInput = {
  id: string;
  balanceMinor: number;
  currency: string;
  asOf: Date | string;
};

export type AccountInvestmentSnapshotInput = {
  id: string;
  asOf: Date | string;
  currency: string;
  status: "COMPLETE" | "PARTIAL" | string;
  cashMinor: number;
  holdingsMinor: number;
  totalMinor: number;
  holdingCount: number;
  pricedHoldingCount: number;
  earliestPriceAsOf?: Date | string | null;
  latestPriceAsOf?: Date | string | null;
};

export type AccountDataHealthInput = {
  id: string;
  name: string;
  currency: string;
  type: string;
  country?: string;
  holdings: AccountHoldingInput[];
  transactions: AccountTransactionInput[];
  snapshots: AccountBalanceSnapshotInput[];
  investmentSnapshots?: AccountInvestmentSnapshotInput[];
  fxRates: FxRateInput[];
  today?: Date;
  displayCurrency?: Currency;
};

export type AccountDataHealthReport = {
  status: "tracking" | "incomplete" | "needs-setup";
  statusLabel: string;
  isComplete: boolean;
  hasSetupData: boolean;
  issues: AccountHealthIssue[];
  latestSnapshot: {
    asOf: string;
    status: "COMPLETE" | "PARTIAL" | string;
    isUpToDate: boolean;
    holdingCount: number;
    pricedHoldingCount: number;
  } | null;
  latestCompleteAsOf: string | null;
  expectedCaptureDate: string;
  cashHealth: {
    ok: boolean;
    source: "snapshot" | "derived" | "none";
    balanceMinor: number;
    currency: string;
    error?: string;
  };
  holdingsHealth: {
    totalCount: number;
    pricedCount: number;
    staleCount: number;
    missingPriceCount: number;
    missingFxCount: number;
    assumedCurrencyCount: number;
    staleHoldings: Array<{ symbol: string; asOf: string }>;
    missingPriceHoldings: string[];
    missingFxHoldings: Array<{ symbol: string; priceCurrency: string }>;
    assumedCurrencyHoldings: string[];
  };
  fxHealth: {
    missingPairs: Array<{ from: string; to: string }>;
  };
};

function dateKey(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function numberFromDecimal(value: unknown): number {
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    return (value as { toNumber(): number }).toNumber();
  }
  return Number(value);
}

export function expectedCaptureDate(today: Date): string {
  const expected = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  if (today.getUTCHours() < 4) expected.setUTCDate(expected.getUTCDate() - 1);
  return expected.toISOString().slice(0, 10);
}

export function diagnoseAccountDataHealth(input: AccountDataHealthInput): AccountDataHealthReport {
  const today = input.today ?? new Date();
  const displayCurrency = input.displayCurrency ?? "CAD";
  const accountCurrency = (input.currency.toUpperCase() as Currency) || "CAD";
  const expectedDate = expectedCaptureDate(today);

  const hasSetupData =
    input.holdings.length > 0 || input.transactions.length > 0 || input.snapshots.length > 0;

  const issues: AccountHealthIssue[] = [];

  // 1. Cash Balance Assessment
  const txInputs: CurrencyTxInput[] = input.transactions.map((t) => ({
    type: t.type as TxTypeName,
    amountMinor: t.amountMinor,
    currency: t.currency.toUpperCase(),
    date: dateKey(t.date),
  }));
  const snapshotInputs: CurrencySnapshotInput[] = input.snapshots.map((s) => ({
    balanceMinor: s.balanceMinor,
    currency: s.currency.toUpperCase(),
    asOf: dateKey(s.asOf),
  }));

  const balanceResult = accountBalanceWithCurrency(txInputs, snapshotInputs, accountCurrency);
  let cashOk = balanceResult.ok;
  let cashError: string | undefined;

  if (!balanceResult.ok) {
    cashError = balanceResult.error;
    issues.push({
      id: "cash-balance-error",
      category: "cash",
      severity: "error",
      title: "Cash Balance Calculation Error",
      description: balanceResult.error,
      actionHint: "Record a point-in-time balance snapshot or review recent transactions.",
    });
  } else if (balanceResult.currency.toUpperCase() !== accountCurrency) {
    const cashCurrency = balanceResult.currency.toUpperCase() as Currency;
    const fxFound = findFxRate(input.fxRates, cashCurrency, accountCurrency);
    if (!fxFound) {
      cashOk = false;
      cashError = `Missing FX rate to convert cash from ${cashCurrency} to ${accountCurrency}`;
      issues.push({
        id: "cash-missing-fx",
        category: "cash",
        severity: "error",
        title: "Cash Currency Mismatch",
        description: `Cash balance is recorded in ${cashCurrency}, but no exchange rate was found to convert to account currency (${accountCurrency}).`,
        actionHint: "Add an FX exchange rate or record a snapshot in the account's currency.",
      });
    }
  }

  // 2. Holdings Valuation Assessment
  const holdingsData = input.holdings.map((h) => ({
    symbol: h.symbol,
    quantity: numberFromDecimal(h.quantity),
    lastPriceMinor: h.lastPriceMinor,
    priceCurrency: h.priceCurrency?.toUpperCase() ?? null,
  }));

  const valuation = holdingsValuation(holdingsData, accountCurrency, input.fxRates);

  const missingPriceHoldings: string[] = [];
  const assumedCurrencyHoldings: string[] = [];
  const staleHoldings: Array<{ symbol: string; asOf: string }> = [];
  const missingFxHoldings: Array<{ symbol: string; priceCurrency: string }> = [];
  const missingFxPairs: Array<{ from: string; to: string }> = [];

  for (const holding of input.holdings) {
    const priceDate = dateKey(holding.priceAsOf);
    const pCurrency = holding.priceCurrency?.toUpperCase() ?? null;

    if (!holding.lastPriceMinor || holding.lastPriceMinor <= 0) {
      missingPriceHoldings.push(holding.symbol);
    }

    if (!pCurrency) {
      assumedCurrencyHoldings.push(holding.symbol);
    } else if (pCurrency !== accountCurrency) {
      const rateFound = findFxRate(input.fxRates, pCurrency as Currency, accountCurrency);
      if (!rateFound) {
        missingFxHoldings.push({ symbol: holding.symbol, priceCurrency: pCurrency });
        if (!missingFxPairs.some((p) => p.from === pCurrency && p.to === accountCurrency)) {
          missingFxPairs.push({ from: pCurrency, to: accountCurrency });
        }
      }
    }

    if (pCurrency && accountCurrency !== displayCurrency) {
      const displayRateFound = findFxRate(input.fxRates, accountCurrency, displayCurrency);
      if (!displayRateFound) {
        if (!missingFxPairs.some((p) => p.from === accountCurrency && p.to === displayCurrency)) {
          missingFxPairs.push({ from: accountCurrency, to: displayCurrency });
        }
      }
    }

    const isStaleStatus =
      holding.priceStatus?.toUpperCase() === "STALE" ||
      holding.priceStatus?.toUpperCase() === "UNAVAILABLE";
    const isOldDate = priceDate < expectedDate;

    if (isStaleStatus || isOldDate) {
      staleHoldings.push({ symbol: holding.symbol, asOf: priceDate });
    }
  }

  // Record Holdings Issues
  if (missingPriceHoldings.length > 0) {
    issues.push({
      id: "unpriced-holdings",
      category: "price",
      severity: "error",
      title: "Unpriced Holdings",
      description: `The following holdings have no valid market price ($0.00): ${missingPriceHoldings.join(", ")}.`,
      actionHint: "Enter a manual price or click 'Refresh prices' to quote automatically.",
      affectedSymbols: missingPriceHoldings,
    });
  }

  if (missingFxHoldings.length > 0) {
    issues.push({
      id: "missing-fx-rates",
      category: "fx",
      severity: "error",
      title: "Missing Foreign Exchange Rates",
      description: `Cannot convert holdings valued in foreign currencies: ${missingFxHoldings.map((h) => `${h.symbol} (${h.priceCurrency} -> ${accountCurrency})`).join(", ")}.`,
      actionHint: "FX rates will automatically sync overnight, or you can refresh prices now.",
      affectedSymbols: missingFxHoldings.map((h) => h.symbol),
    });
  }

  if (assumedCurrencyHoldings.length > 0) {
    issues.push({
      id: "assumed-currency",
      category: "price",
      severity: "warning",
      title: "Unassigned Price Currency",
      description: `The following holdings were entered before price currencies were tracked and are assumed to be in ${accountCurrency}: ${assumedCurrencyHoldings.join(", ")}.`,
      actionHint: "Click 'Refresh prices' to update positions with verified market currencies.",
      affectedSymbols: assumedCurrencyHoldings,
    });
  }

  if (staleHoldings.length > 0 && missingPriceHoldings.length === 0) {
    issues.push({
      id: "stale-market-quotes",
      category: "price",
      severity: "warning",
      title: "Market Quotes Need Refresh",
      description: `Prices for ${staleHoldings.map((h) => `${h.symbol} (as of ${h.asOf})`).join(", ")} are from prior sessions.`,
      actionHint: "Click 'Refresh prices' to fetch the latest market quotes.",
      affectedSymbols: staleHoldings.map((h) => h.symbol),
    });
  }

  // 3. Investment Daily Snapshots Assessment
  const sortedSnapshots = [...(input.investmentSnapshots ?? [])].sort((a, b) =>
    dateKey(a.asOf).localeCompare(dateKey(b.asOf)),
  );

  const completeSnapshots = sortedSnapshots.filter((s) => s.status === "COMPLETE");
  const latestSnapshotRaw = sortedSnapshots.at(-1);
  const latestCompleteRaw = completeSnapshots.at(-1);

  const latestAsOf = latestSnapshotRaw ? dateKey(latestSnapshotRaw.asOf) : null;
  const latestCompleteAsOf = latestCompleteRaw ? dateKey(latestCompleteRaw.asOf) : null;
  const isSnapshotUpToDate = latestAsOf !== null && latestAsOf >= expectedDate;

  if (hasSetupData) {
    if (!latestSnapshotRaw) {
      issues.push({
        id: "snapshot-none",
        category: "snapshot",
        severity: "warning",
        title: "Daily Performance Baseline Pending",
        description: "No daily valuation snapshots have been recorded yet for this account. Daily return and gain tracking begins after the first complete daily snapshot.",
        actionHint: "Click 'Refresh prices' to record the opening baseline snapshot.",
      });
    } else if (latestSnapshotRaw.status === "PARTIAL") {
      issues.push({
        id: "snapshot-partial",
        category: "snapshot",
        severity: "error",
        title: "Latest Daily Valuation Was Incomplete (Partial)",
        description: `The daily snapshot on ${latestAsOf} was recorded as PARTIAL (${latestSnapshotRaw.pricedHoldingCount}/${latestSnapshotRaw.holdingCount} holdings priced). Partial snapshots are excluded from performance return calculations.`,
        actionHint: "Resolve holding price or FX issues above, then refresh prices to record a complete valuation.",
      });
    } else if (!isSnapshotUpToDate) {
      issues.push({
        id: "snapshot-outdated",
        category: "snapshot",
        severity: "warning",
        title: "Daily Valuation Pending Update",
        description: `Last complete daily valuation was recorded on ${latestCompleteAsOf}. The expected valuation for ${expectedDate} has not been captured yet.`,
        actionHint: "Click 'Refresh prices' to capture today's valuation snapshot.",
      });
    }
  } else {
    issues.push({
      id: "needs-setup",
      category: "setup",
      severity: "info",
      title: "Account Setup Required",
      description: "This account has no holdings, transactions, or cash snapshots recorded.",
      actionHint: "Add holdings positions or record a cash balance to start tracking.",
    });
  }

  // Determine overall status
  let status: AccountDataHealthReport["status"];
  let statusLabel: string;

  if (!hasSetupData) {
    status = "needs-setup";
    statusLabel = "Needs Setup";
  } else if (
    !latestCompleteRaw ||
    latestSnapshotRaw?.status === "PARTIAL" ||
    !latestSnapshotRaw ||
    dateKey(latestSnapshotRaw.asOf) < expectedDate ||
    !cashOk ||
    missingPriceHoldings.length > 0 ||
    missingFxHoldings.length > 0
  ) {
    status = "incomplete";
    statusLabel = "Data Incomplete";
  } else {
    status = "tracking";
    statusLabel = "Tracking";
  }

  const isComplete = status === "tracking";

  return {
    status,
    statusLabel,
    isComplete,
    hasSetupData,
    issues,
    latestSnapshot: latestSnapshotRaw
      ? {
          asOf: dateKey(latestSnapshotRaw.asOf),
          status: latestSnapshotRaw.status,
          isUpToDate: isSnapshotUpToDate,
          holdingCount: latestSnapshotRaw.holdingCount,
          pricedHoldingCount: latestSnapshotRaw.pricedHoldingCount,
        }
      : null,
    latestCompleteAsOf,
    expectedCaptureDate: expectedDate,
    cashHealth: {
      ok: cashOk,
      source: balanceResult.ok ? balanceResult.source : "none",
      balanceMinor: balanceResult.ok ? balanceResult.balanceMinor : 0,
      currency: balanceResult.ok ? balanceResult.currency : accountCurrency,
      error: cashError,
    },
    holdingsHealth: {
      totalCount: input.holdings.length,
      pricedCount: input.holdings.length - missingPriceHoldings.length,
      staleCount: staleHoldings.length,
      missingPriceCount: missingPriceHoldings.length,
      missingFxCount: missingFxHoldings.length,
      assumedCurrencyCount: assumedCurrencyHoldings.length,
      staleHoldings,
      missingPriceHoldings,
      missingFxHoldings,
      assumedCurrencyHoldings,
    },
    fxHealth: {
      missingPairs: missingFxPairs,
    },
  };
}
