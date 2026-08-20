import Link from "next/link";
import { Activity, Plus, TrendingUp, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  PerformanceWorkspace,
  type InvestmentAccountMeta,
} from "@/components/investments/performance-workspace";
import { accountBalanceWithCurrency, holdingsValuation } from "@/engine/balance";
import { convertMinor, type FxRateInput } from "@/engine/fx";
import type { Currency } from "@/engine/money";
import { netWorth, type AccountBalanceRow } from "@/engine/networth";
import {
  buildPerformanceWorkspace,
  type PerformanceAccountInput,
  type PerformanceRange,
  type PerformanceWorkspaceView,
} from "@/lib/domain/investments/performanceReadModel";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

const RANGES: PerformanceRange[] = ["1M", "3M", "YTD", "1Y", "ALL"];

export default async function InvestmentsPage() {
  const userId = await requireUserId();
  const now = new Date();
  const [accounts, fxRatesRaw] = await Promise.all([
    prisma.financialAccount.findMany({
      where: { userId },
      include: {
        transactions: true,
        snapshots: true,
        holdings: true,
        investmentSnapshots: {
          include: { positions: true },
          orderBy: { asOf: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.fxRate.findMany({
      where: { userId, asOf: { lte: now } },
      orderBy: [{ quote: "asc" }, { asOf: "desc" }],
    }),
  ]);

  const rates: FxRateInput[] = fxRatesRaw.map((rate) => ({
    base: rate.base as Currency,
    quote: rate.quote as Currency,
    rate: Number(rate.rate),
    asOf: rate.asOf.toISOString(),
  }));

  const performanceAccounts: PerformanceAccountInput[] = accounts.map((account) => ({
    id: account.id,
    name: account.name,
    currency: account.currency as Currency,
    hasSetupData:
      account.holdings.length > 0 || account.transactions.length > 0 || account.snapshots.length > 0,
    snapshots: account.investmentSnapshots.map((snapshot) => ({
      asOf: snapshot.asOf.toISOString().slice(0, 10),
      currency: snapshot.currency as Currency,
      cashMinor: snapshot.cashMinor,
      holdingsMinor: snapshot.holdingsMinor,
      totalMinor: snapshot.totalMinor,
      netExternalFlowMinor: snapshot.netExternalFlowMinor,
      displayTotalMinor: snapshot.displayTotalMinor,
      displayExternalFlowMinor: snapshot.displayExternalFlowMinor,
      status: snapshot.status,
      positions: snapshot.positions.map((position) => ({
        symbol: position.symbol,
        quantity: Number(position.quantity),
        displayValueMinor: position.displayMarketValueMinor,
      })),
    })),
  }));

  const views = Object.fromEntries(
    RANGES.map((range) => [range, buildPerformanceWorkspace(performanceAccounts, range, now)]),
  ) as Record<PerformanceRange, PerformanceWorkspaceView>;

  const currentRows = accounts.map((account) => {
    const hasSetupData =
      account.holdings.length > 0 || account.transactions.length > 0 || account.snapshots.length > 0;
    const balance = accountBalanceWithCurrency(
      account.transactions.map((transaction) => ({
        type: transaction.type,
        amountMinor: transaction.amountMinor,
        date: transaction.date.toISOString(),
        currency: transaction.currency,
      })),
      account.snapshots.map((snapshot) => ({
        balanceMinor: snapshot.balanceMinor,
        currency: snapshot.currency,
        asOf: snapshot.asOf.toISOString(),
      })),
      account.currency,
    );
    const valuation = holdingsValuation(
      account.holdings.map((holding) => ({
        symbol: holding.symbol,
        quantity: Number(holding.quantity),
        lastPriceMinor: holding.lastPriceMinor,
        priceCurrency: holding.priceCurrency,
      })),
      account.currency,
      rates,
    );
    let cashMinor: number | null = null;
    if (balance.ok) {
      try {
        cashMinor = convertMinor(
          balance.balanceMinor,
          balance.currency as Currency,
          account.currency as Currency,
          rates,
        );
      } catch {
        // A cash balance in another currency is unknown without matching FX.
      }
    }
    const priceEvidenceComplete = account.holdings.every(
      (holding) =>
        holding.priceCurrency !== null &&
        holding.priceStatus?.toUpperCase() !== "STALE" &&
        holding.priceStatus?.toUpperCase() !== "UNAVAILABLE",
    );
    const fallbackCurrentValueMinor =
      hasSetupData &&
      cashMinor !== null &&
      valuation.complete &&
      valuation.assumedCurrency.length === 0 &&
      priceEvidenceComplete
        ? cashMinor + valuation.valueMinor
        : null;

    return {
      account,
      hasSetupData,
      fallbackCurrentValueMinor,
      cashMinor,
    };
  });

  const accountMeta: InvestmentAccountMeta[] = currentRows.map(
    ({ account, fallbackCurrentValueMinor, cashMinor }) => ({
      id: account.id,
      type: account.type,
      institution: account.institution,
      country: account.country,
      isUSSitus: account.isUSSitus,
      holdingCount: account.holdings.length,
      fallbackCurrentValueMinor,
      cashMinor,
    }),
  );

  const configuredRows = currentRows.filter((row) => row.hasSetupData);
  let fallbackPortfolioValueMinor: number | null = null;
  if (
    configuredRows.length > 0 &&
    configuredRows.every((row) => row.fallbackCurrentValueMinor !== null)
  ) {
    try {
      const rows: AccountBalanceRow[] = configuredRows.map((row) => ({
        id: row.account.id,
        name: row.account.name,
        type: row.account.type,
        currency: row.account.currency as Currency,
        balanceMinor: row.fallbackCurrentValueMinor!,
      }));
      fallbackPortfolioValueMinor = netWorth(rows, "CAD", rates).totalMinor;
    } catch {
      // Missing FX means the portfolio value is unknown, never an assumed zero.
    }
  }

  const needsAttention = views["1M"].dataHealth.needsAttention;

  return (
    <main className="space-y-7 py-6 sm:py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Investments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track value, cash flows, and investment performance across your accounts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {needsAttention ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="#data-health" className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
                <Activity className="size-3.5" />
                <span>Data health</span>
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link href="/investments/import" className="flex items-center gap-1.5">
              <Upload className="size-3.5" />
              <span>Import</span>
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/investments/new" className="flex items-center gap-1.5">
              <Plus className="size-3.5" />
              <span>Add account</span>
            </Link>
          </Button>
        </div>
      </header>

      {accounts.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="No accounts yet"
          description="Track your registered accounts (TFSA, RRSP, RDSP, FHSA), cash, and crypto in one place."
          action={{ label: "Add your first account", href: "/investments/new" }}
          secondaryAction={{ label: "Import from JSON", href: "/investments/import" }}
        />
      ) : (
        <PerformanceWorkspace
          views={views}
          accounts={accountMeta}
          fallbackPortfolioValueMinor={fallbackPortfolioValueMinor}
        />
      )}
    </main>
  );
}
