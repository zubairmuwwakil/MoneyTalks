import {
  ArrowLeft,
  FileSpreadsheet,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addHolding,
  addSnapshot,
  addTransaction,
  deleteAccount,
  deleteHolding,
  deleteSnapshot,
  deleteTransaction,
  setCashBalance,
  updateAccount,
  updateTransaction,
} from "@/app/investments/actions";
import { refreshPrices } from "@/app/actions/refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  UrlStatusBanner,
  RefreshPricesButton,
  PortfolioAllocationBar,
  SetCashModal,
  AccountDetailInteractiveView,
  type HoldingViewItem,
  type TransactionViewItem,
  type SnapshotViewItem,
  type AllocationItem,
} from "@/components/investments/account-detail-client";
import {
  AccountDataHealthCard,
  AccountStatusBadge,
} from "@/components/investments/account-data-health";
import { diagnoseAccountDataHealth } from "@/lib/domain/investments/accountDataHealth";
import { accountBalanceWithCurrency, holdingValueMinor, holdingsValuation } from "@/engine/balance";
import type { FxRateInput } from "@/engine/fx";
import { formatMinorUnits, type Currency } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; errorForm?: string; pricesOk?: string; pricesError?: string }>;
}) {
  const userId = await requireUserId();
  const { id } = await params;
  const { error, errorForm, pricesOk, pricesError } = await searchParams;
  const now = new Date();

  const [account, fxRatesRaw] = await Promise.all([
    prisma.financialAccount.findFirst({
      where: { id, userId },
      include: {
        holdings: { orderBy: { symbol: "asc" } },
        transactions: { orderBy: { date: "desc" } },
        snapshots: { orderBy: { asOf: "desc" }, take: 20 },
        investmentSnapshots: { orderBy: { asOf: "desc" }, take: 10 },
      },
    }),
    prisma.fxRate.findMany({
      where: { userId, asOf: { lte: now } },
      orderBy: [{ quote: "asc" }, { asOf: "desc" }],
    }),
  ]);

  if (!account) notFound();

  const rates: FxRateInput[] = fxRatesRaw.map((r) => ({
    base: r.base as Currency,
    quote: r.quote as Currency,
    rate: Number(r.rate),
    asOf: r.asOf.toISOString(),
  }));

  const currency = account.currency as Currency;
  const snapshotInputs = account.snapshots.map((s) => ({
    balanceMinor: s.balanceMinor,
    currency: s.currency as Currency,
    asOf: s.asOf.toISOString(),
  }));

  const balance = accountBalanceWithCurrency(
    account.transactions.map((t) => ({
      type: t.type,
      amountMinor: t.amountMinor,
      date: t.date.toISOString(),
      currency: t.currency,
    })),
    snapshotInputs,
    currency,
  );

  const valuation = holdingsValuation(
    account.holdings.map((h) => ({
      symbol: h.symbol,
      quantity: Number(h.quantity),
      lastPriceMinor: h.lastPriceMinor,
      priceCurrency: h.priceCurrency,
    })),
    currency,
    rates,
  );

  const convertedMap = new Map(valuation.converted.map((c) => [c.symbol, c]));
  const holdingsValue = valuation.valueMinor;

  const totalBookCostMinor = account.holdings.reduce((sum, h) => sum + (h.bookCostMinor ?? 0), 0);
  const holdingsWithBookCost = account.holdings.filter((h) => h.bookCostMinor !== null);
  const totalGainLossMinor =
    holdingsWithBookCost.length > 0 && totalBookCostMinor > 0
      ? holdingsValue - totalBookCostMinor
      : null;

  const healthReport = diagnoseAccountDataHealth({
    id: account.id,
    name: account.name,
    currency: account.currency,
    type: account.type,
    country: account.country,
    holdings: account.holdings,
    transactions: account.transactions,
    snapshots: account.snapshots,
    investmentSnapshots: account.investmentSnapshots,
    fxRates: rates,
    today: now,
  });

  const totalAccountValueMinor = balance.ok ? balance.balanceMinor + holdingsValue : holdingsValue;

  const holdingsViewItems: HoldingViewItem[] = account.holdings.map((h) => {
    const converted = convertedMap.get(h.symbol);
    const convertedValue = converted
      ? converted.convertedValueMinor
      : holdingValueMinor(Number(h.quantity), h.lastPriceMinor);
    const weight = totalAccountValueMinor > 0 ? (convertedValue / totalAccountValueMinor) * 100 : 0;
    return {
      id: h.id,
      symbol: h.symbol,
      name: h.name,
      domicileCountry: h.domicileCountry,
      quantity: Number(h.quantity),
      lastPriceMinor: h.lastPriceMinor,
      priceCurrency: h.priceCurrency,
      priceAsOf: h.priceAsOf.toISOString(),
      priceStatus: h.priceStatus,
      priceSource: h.priceSource,
      bookCostMinor: h.bookCostMinor,
      convertedValueMinor: convertedValue,
      weightPercentage: weight,
    };
  });

  const transactionsViewItems: TransactionViewItem[] = account.transactions.map((t) => ({
    id: t.id,
    type: t.type,
    amountMinor: t.amountMinor,
    currency: t.currency,
    date: t.date.toISOString(),
    description: t.description,
  }));

  const snapshotsViewItems: SnapshotViewItem[] = account.snapshots.map((s) => ({
    id: s.id,
    balanceMinor: s.balanceMinor,
    currency: s.currency,
    asOf: s.asOf.toISOString(),
  }));

  const allocationHoldings: AllocationItem[] = account.holdings.map((h) => ({
    id: h.id,
    symbol: h.symbol,
    name: h.name,
    valueMinor: convertedMap.has(h.symbol)
      ? convertedMap.get(h.symbol)!.convertedValueMinor
      : holdingValueMinor(Number(h.quantity), h.lastPriceMinor),
  }));

  const actions = {
    addHolding,
    deleteHolding,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    addSnapshot,
    deleteSnapshot,
    setCashBalance,
    updateAccount,
    deleteAccount,
  };

  return (
    <main className="space-y-6 py-6 sm:py-8">
      {/* Top Header & Breadcrumbs */}
      <div>
        <Link
          href="/investments"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-3 transition-colors active:scale-95"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to Investments</span>
        </Link>
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{account.name}</h1>
              <Badge variant="secondary" className="text-xs">
                {account.type}
              </Badge>
              {account.isUSSitus ? <Badge variant="warning">US-Situs</Badge> : null}
              <AccountStatusBadge status={healthReport.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {account.institution} · {account.country} · {account.currency}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <RefreshPricesButton
              accountId={account.id}
              action={refreshPrices}
              isCrypto={account.type === "CRYPTO"}
            />
            <Button asChild variant="outline" size="sm">
              <Link href={`/investments/${account.id}/csv`} className="flex items-center gap-1.5">
                <FileSpreadsheet className="size-3.5" />
                <span>Import CSV</span>
              </Link>
            </Button>
          </div>
        </header>
      </div>

      {/* URL Status & Error Bridge (Toasts) */}
      <UrlStatusBanner
        pricesOk={pricesOk}
        pricesError={pricesError}
        error={error}
        errorForm={errorForm}
      />

      {/* Account Data Health Diagnostic Card */}
      <AccountDataHealthCard
        report={healthReport}
        accountId={account.id}
        refreshAction={refreshPrices}
        isCrypto={account.type === "CRYPTO"}
      />

      {/* Hero Balance Summary Card */}
      <Card className="bg-gradient-to-b from-card via-card to-muted/20 border-border/80 shadow-xs">
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Total Account Value
              </p>
              <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums sm:text-4xl text-foreground">
                {formatMinorUnits(totalAccountValueMinor, currency)}
              </p>

              {/* Metric Breakdown Row */}
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
                {/* Cash Pill */}
                <span className="inline-flex items-center gap-1.5 bg-muted/40 px-2.5 py-1 rounded-lg border border-border/60">
                  <span>Cash:</span>
                  <strong className="font-semibold text-foreground">
                    {balance.ok ? formatMinorUnits(balance.balanceMinor, currency) : "Unavailable"}
                  </strong>
                  <SetCashModal
                    accountId={account.id}
                    currentCashMinor={balance.ok ? balance.balanceMinor : 0}
                    currency={currency}
                    action={setCashBalance}
                  />
                </span>

                {/* Holdings Pill */}
                {account.holdings.length > 0 ? (
                  <span className="inline-flex items-center gap-1.5 bg-muted/40 px-2.5 py-1 rounded-lg border border-border/60">
                    <span>Invested:</span>
                    <strong className="font-semibold text-foreground">
                      {formatMinorUnits(holdingsValue, currency)}
                    </strong>
                    {valuation.converted.length > 0 ? (
                      <span className="text-[10px] text-muted-foreground" title="Automatically converted using BoC exchange rates">
                        ({valuation.converted.length} foreign FX)
                      </span>
                    ) : null}
                  </span>
                ) : null}

                {/* Unrealized Return Pill */}
                {totalGainLossMinor !== null && totalBookCostMinor > 0 ? (
                  <span className="inline-flex items-center gap-1.5 bg-muted/40 px-2.5 py-1 rounded-lg border border-border/60">
                    <span>Unrealized P&L:</span>
                    <strong
                      className={`font-semibold tabular-nums ${
                        totalGainLossMinor >= 0
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {totalGainLossMinor >= 0 ? "+" : ""}
                      {formatMinorUnits(totalGainLossMinor, currency)} (
                      {totalGainLossMinor >= 0 ? "+" : ""}
                      {((totalGainLossMinor / totalBookCostMinor) * 100).toFixed(1)}%)
                    </strong>
                  </span>
                ) : null}
              </div>
            </div>

            {account.holdings.length > 0 ? (
              <div className="sm:text-right border-t sm:border-t-0 pt-2 sm:pt-0 border-border/60">
                <p className="text-xs text-muted-foreground">Positions Count</p>
                <p className="text-lg font-semibold tabular-nums text-foreground">
                  {account.holdings.length} {account.holdings.length === 1 ? "position" : "positions"}
                </p>
              </div>
            ) : null}
          </div>

          {/* Visual Portfolio Allocation Weight Bar */}
          <PortfolioAllocationBar
            cashMinor={balance.ok ? balance.balanceMinor : 0}
            currency={currency}
            holdings={allocationHoldings}
          />
        </CardContent>
      </Card>

      {/* Main Interactive Controller (Tabs, Modals, Action Drawers & Lists) */}
      <AccountDetailInteractiveView
        account={{
          id: account.id,
          name: account.name,
          institution: account.institution,
          type: account.type,
          country: account.country,
          currency: account.currency,
          isUSSitus: account.isUSSitus,
        }}
        currency={currency}
        holdings={holdingsViewItems}
        transactions={transactionsViewItems}
        snapshots={snapshotsViewItems}
        cashMinor={balance.ok ? balance.balanceMinor : 0}
        totalValueMinor={totalAccountValueMinor}
        totalBookCostMinor={totalBookCostMinor}
        totalGainLossMinor={totalGainLossMinor}
        allocationHoldings={allocationHoldings}
        actions={actions}
      />
    </main>
  );
}
