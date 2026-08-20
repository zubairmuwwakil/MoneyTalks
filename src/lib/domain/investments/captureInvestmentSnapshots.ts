import { InvestmentSnapshotStatus, type Prisma, type PrismaClient } from "@prisma/client";
import {
  accountBalanceWithCurrency,
  holdingsValuation,
  type CurrencySnapshotInput,
  type CurrencyTxInput,
} from "@/engine/balance";
import { convertMinor, findFxRate, type FxRateInput } from "@/engine/fx";
import type { Currency } from "@/engine/money";

export type CaptureOutcome = {
  accounts: number;
  complete: number;
  partial: number;
  failed: number;
};

export type CaptureOptions = {
  asOf?: Date;
  displayCurrency?: Currency;
};

type SnapshotFlowClient = Pick<
  Prisma.TransactionClient,
  "investmentAccountSnapshot" | "transaction"
>;

type ExternalTransaction = {
  type: string;
  amountMinor: number;
  currency: string;
  date: Date;
};

function utcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function utcDayEnd(value: Date): Date {
  return new Date(utcDay(value).getTime() + 86_400_000 - 1);
}

function numberFromDecimal(value: unknown): number {
  const numberValue =
    typeof value === "object" && value !== null && "toNumber" in value
      ? (value as { toNumber(): number }).toNumber()
      : Number(value);
  if (!Number.isFinite(numberValue)) throw new RangeError(`expected a finite decimal, got ${numberValue}`);
  return numberValue;
}

function safeAdd(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new RangeError(`${label} must be a safe integer`);
  return result;
}

function normalizeRates(
  rows: Array<{ base: string; quote: string; rate: unknown; asOf: Date }>,
): FxRateInput[] {
  return rows.map((row) => ({
    base: row.base.toUpperCase() as Currency,
    quote: row.quote.toUpperCase() as Currency,
    rate: numberFromDecimal(row.rate),
    asOf: row.asOf.toISOString(),
  }));
}

function conversionToDisplay(
  amountMinor: number,
  from: string,
  displayCurrency: Currency,
  rates: FxRateInput[],
):
  | { ok: true; amountMinor: number; effectiveRate: number | null; fxAsOf: Date | null }
  | { ok: false; amountMinor: 0; effectiveRate: null; fxAsOf: null } {
  const sourceCurrency = from.toUpperCase() as Currency;
  if (sourceCurrency === displayCurrency) {
    return { ok: true, amountMinor, effectiveRate: null, fxAsOf: null };
  }

  const found = findFxRate(rates, sourceCurrency, displayCurrency);
  if (!found) return { ok: false, amountMinor: 0, effectiveRate: null, fxAsOf: null };

  return {
    ok: true,
    amountMinor: convertMinor(amountMinor, sourceCurrency, displayCurrency, rates),
    effectiveRate: found.inverted ? 1 / found.rate.rate : found.rate.rate,
    fxAsOf: new Date(found.rate.asOf),
  };
}

function externalFlowSince(
  transactions: ExternalTransaction[],
  previousCompleteAsOf: Date | null,
  through: Date,
  currency: string,
): number {
  if (previousCompleteAsOf === null) return 0;
  const after = utcDayEnd(previousCompleteAsOf);

  return transactions.reduce((sum, transaction) => {
    if (transaction.date <= after || transaction.date > through) return sum;
    if (transaction.currency.toUpperCase() !== currency.toUpperCase()) return sum;
    if (transaction.type !== "CONTRIBUTION" && transaction.type !== "WITHDRAWAL") return sum;
    const signed = transaction.type === "CONTRIBUTION" ? transaction.amountMinor : -transaction.amountMinor;
    return safeAdd(sum, signed, "external flow");
  }, 0);
}

function externalFlowCurrenciesMatch(
  transactions: ExternalTransaction[],
  previousCompleteAsOf: Date | null,
  through: Date,
  currency: string,
): boolean {
  if (previousCompleteAsOf === null) return true;
  const after = utcDayEnd(previousCompleteAsOf);
  return transactions
    .filter(
      (transaction) =>
        transaction.date > after &&
        transaction.date <= through &&
        (transaction.type === "CONTRIBUTION" || transaction.type === "WITHDRAWAL"),
    )
    .every((transaction) => transaction.currency.toUpperCase() === currency.toUpperCase());
}

function staleOrUnavailable(status: string | null): boolean {
  const normalized = status?.toUpperCase();
  return normalized === "STALE" || normalized === "UNAVAILABLE";
}

export async function captureInvestmentSnapshots(
  prisma: PrismaClient,
  userId: string,
  options: CaptureOptions = {},
): Promise<CaptureOutcome> {
  const asOf = utcDay(options.asOf ?? new Date());
  const through = utcDayEnd(asOf);
  const displayCurrency = options.displayCurrency ?? "CAD";

  const [accounts, fxRows] = await Promise.all([
    prisma.financialAccount.findMany({
      where: { userId },
      include: {
        holdings: true,
        transactions: { where: { date: { lte: through } }, orderBy: { date: "asc" } },
        snapshots: { where: { asOf: { lte: through } }, orderBy: { asOf: "asc" } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.fxRate.findMany({
      where: { userId, asOf: { lte: through } },
      select: { base: true, quote: true, rate: true, asOf: true },
      orderBy: { asOf: "desc" },
    }),
  ]);
  const rates = normalizeRates(fxRows);
  const outcome: CaptureOutcome = {
    accounts: accounts.length,
    complete: 0,
    partial: 0,
    failed: 0,
  };

  for (const account of accounts) {
    try {
      const accountCurrency = account.currency.toUpperCase();
      const transactions: CurrencyTxInput[] = account.transactions.map((transaction) => ({
        type: transaction.type,
        amountMinor: transaction.amountMinor,
        currency: transaction.currency.toUpperCase(),
        date: transaction.date.toISOString(),
      }));
      const balanceSnapshots: CurrencySnapshotInput[] = account.snapshots.map((snapshot) => ({
        balanceMinor: snapshot.balanceMinor,
        currency: snapshot.currency.toUpperCase(),
        asOf: snapshot.asOf.toISOString(),
      }));
      const holdings = account.holdings.map((holding) => ({
        symbol: holding.symbol,
        quantity: numberFromDecimal(holding.quantity),
        lastPriceMinor: holding.lastPriceMinor,
        priceCurrency: holding.priceCurrency?.toUpperCase() ?? null,
      }));

      const balance = accountBalanceWithCurrency(transactions, balanceSnapshots, accountCurrency);
      let cashMinor = 0;
      let cashComplete = balance.ok;
      if (balance.ok) {
        try {
          cashMinor = convertMinor(
            balance.balanceMinor,
            balance.currency.toUpperCase() as Currency,
            accountCurrency as Currency,
            rates,
          );
        } catch {
          cashComplete = false;
        }
      }

      const holdingsSummary = holdingsValuation(holdings, accountCurrency, rates);
      const totalMinor = safeAdd(cashMinor, holdingsSummary.valueMinor, "account total");
      const displayTotal = conversionToDisplay(totalMinor, accountCurrency, displayCurrency, rates);
      const hasSetupData =
        account.holdings.length > 0 || account.transactions.length > 0 || account.snapshots.length > 0;

      const positions = account.holdings.map((holding) => {
        const quantity = numberFromDecimal(holding.quantity);
        const priceCurrency = holding.priceCurrency?.toUpperCase() ?? null;
        const singleValuation = holdingsValuation(
          [
            {
              symbol: holding.symbol,
              quantity,
              lastPriceMinor: holding.lastPriceMinor,
              priceCurrency,
            },
          ],
          accountCurrency,
          rates,
        );
        const nativeComplete = singleValuation.complete && singleValuation.assumedCurrency.length === 0;
        const displayValue = nativeComplete
          ? conversionToDisplay(singleValuation.valueMinor, accountCurrency, displayCurrency, rates)
          : { ok: false as const, amountMinor: 0 as const, effectiveRate: null, fxAsOf: null };
        const valuationComplete =
          nativeComplete && displayValue.ok && !staleOrUnavailable(holding.priceStatus);

        return {
          holdingId: holding.id,
          symbol: holding.symbol,
          name: holding.name,
          quantity: holding.quantity,
          priceMinor: holding.lastPriceMinor,
          priceCurrency,
          priceAsOf: holding.priceAsOf,
          priceSource: holding.priceSource,
          priceStatus: holding.priceStatus,
          marketValueMinor: singleValuation.valueMinor,
          displayMarketValueMinor: displayValue.amountMinor,
          valuationComplete,
        };
      });

      let complete =
        hasSetupData &&
        cashComplete &&
        holdingsSummary.complete &&
        holdingsSummary.assumedCurrency.length === 0 &&
        positions.every((position) => position.valuationComplete) &&
        displayTotal.ok;
      const pricedHoldings = account.holdings.filter(
        (holding) => holding.priceCurrency !== null && holding.priceStatus?.toUpperCase() !== "UNAVAILABLE",
      );
      const priceDates = account.holdings.map((holding) => holding.priceAsOf.getTime());

      await prisma.$transaction(async (tx) => {
        const previousComplete = await tx.investmentAccountSnapshot.findFirst({
          where: { accountId: account.id, status: "COMPLETE", asOf: { lt: asOf } },
          select: { asOf: true },
          orderBy: { asOf: "desc" },
        });
        const nativeFlow = externalFlowSince(
          account.transactions,
          previousComplete?.asOf ?? null,
          through,
          accountCurrency,
        );
        complete =
          complete &&
          externalFlowCurrenciesMatch(
            account.transactions,
            previousComplete?.asOf ?? null,
            through,
            accountCurrency,
          );
        const status = complete
          ? InvestmentSnapshotStatus.COMPLETE
          : InvestmentSnapshotStatus.PARTIAL;
        const displayFlow = conversionToDisplay(nativeFlow, accountCurrency, displayCurrency, rates);
        const snapshotData = {
          currency: accountCurrency,
          cashMinor,
          holdingsMinor: holdingsSummary.valueMinor,
          totalMinor,
          netExternalFlowMinor: nativeFlow,
          displayCurrency,
          displayTotalMinor: displayTotal.amountMinor,
          displayExternalFlowMinor: displayFlow.amountMinor,
          fxRateToDisplay: displayTotal.effectiveRate,
          fxAsOf: displayTotal.fxAsOf,
          status,
          holdingCount: account.holdings.length,
          pricedHoldingCount: pricedHoldings.length,
          earliestPriceAsOf: priceDates.length > 0 ? new Date(Math.min(...priceDates)) : null,
          latestPriceAsOf: priceDates.length > 0 ? new Date(Math.max(...priceDates)) : null,
        };
        const snapshot = await tx.investmentAccountSnapshot.upsert({
          where: { accountId_asOf: { accountId: account.id, asOf } },
          create: { accountId: account.id, asOf, ...snapshotData },
          update: snapshotData,
        });

        await tx.investmentPositionSnapshot.deleteMany({
          where: { accountSnapshotId: snapshot.id },
        });
        if (positions.length > 0) {
          await tx.investmentPositionSnapshot.createMany({
            data: positions.map((position) => ({
              accountSnapshotId: snapshot.id,
              ...position,
            })),
          });
        }
      });

      if (complete) outcome.complete += 1;
      else outcome.partial += 1;
    } catch {
      outcome.failed += 1;
    }
  }

  return outcome;
}

export async function recomputeSnapshotFlows(
  prisma: SnapshotFlowClient,
  accountId: string,
  from: Date,
): Promise<void> {
  const normalizedFrom = utcDay(from);
  const snapshots = await prisma.investmentAccountSnapshot.findMany({
    where: { accountId, asOf: { gte: normalizedFrom } },
    select: {
      id: true,
      asOf: true,
      currency: true,
      displayCurrency: true,
      fxRateToDisplay: true,
      status: true,
    },
    orderBy: { asOf: "asc" },
  });
  if (snapshots.length === 0) return;

  const previous = await prisma.investmentAccountSnapshot.findFirst({
    where: { accountId, status: "COMPLETE", asOf: { lt: snapshots[0].asOf } },
    select: { asOf: true },
    orderBy: { asOf: "desc" },
  });
  let previousCompleteAsOf = previous?.asOf ?? null;
  const transactions = await prisma.transaction.findMany({
    where: {
      accountId,
      type: { in: ["CONTRIBUTION", "WITHDRAWAL"] },
      date: {
        ...(previousCompleteAsOf ? { gt: utcDayEnd(previousCompleteAsOf) } : {}),
        lte: utcDayEnd(snapshots.at(-1)!.asOf),
      },
    },
    select: { type: true, amountMinor: true, currency: true, date: true },
    orderBy: { date: "asc" },
  });

  for (const snapshot of snapshots) {
    const nativeFlow = externalFlowSince(
      transactions,
      previousCompleteAsOf,
      utcDayEnd(snapshot.asOf),
      snapshot.currency,
    );
    const effectiveRate = snapshot.fxRateToDisplay === null ? null : numberFromDecimal(snapshot.fxRateToDisplay);
    const displayFlow =
      snapshot.currency === snapshot.displayCurrency
        ? nativeFlow
        : effectiveRate === null
          ? 0
          : Math.round(nativeFlow * effectiveRate);
    if (!Number.isSafeInteger(displayFlow)) {
      throw new RangeError("display external flow must be a safe integer");
    }

    await prisma.investmentAccountSnapshot.update({
      where: { id: snapshot.id },
      data: { netExternalFlowMinor: nativeFlow, displayExternalFlowMinor: displayFlow },
    });
    if (snapshot.status === "COMPLETE") previousCompleteAsOf = snapshot.asOf;
  }
}
