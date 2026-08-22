import Link from "next/link";
import { LogOut, RefreshCw } from "lucide-react";
import { SignOutButton } from "@clerk/nextjs";
import { refreshFxRates } from "@/app/actions/refresh";
import { NetWorthHistory } from "@/components/net-worth-history";
import {
  DashboardPulseBarAndDrawer,
  type DrawerAccountItem,
  type DrawerAlertItem,
  type DrawerBillItem,
} from "@/components/dashboard-drawer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { accountBalanceWithCurrency, holdingsValuation } from "@/engine/balance";
import { billOccurrences } from "@/engine/billforecast";
import { MissingFxRateError, type FxRateInput } from "@/engine/fx";
import { formatMinorUnits, type Currency } from "@/engine/money";
import { netWorth } from "@/engine/networth";
import type { Cadence, ScheduleEntry } from "@/engine/recurrence";
import { ALL_RULES, applyDismissals, evaluateRules } from "@/engine/rules";
import { prisma } from "@/lib/prisma";
import { getOrCreateProfile } from "@/lib/profile";
import { getOptionalUser } from "@/lib/require-user";
import { MarketingContent } from "@/components/marketing/marketing-content";
import { buildSnapshot } from "@/lib/snapshot";
import { buildNetWorthHistory } from "@/lib/domain/net-worth/netWorthHistory";
import { cn } from "@/lib/utils";

const CURRENCIES: Currency[] = ["CAD", "USD", "JMD"];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ ccy?: string; display?: string; fxOk?: string; fxError?: string }>;
}) {
  const user = await getOptionalUser();
  if (!user) {
    return <MarketingContent />;
  }
  const userId = user.id;
  const { ccy, display: displayParam, fxOk, fxError } = await searchParams;
  const ccyParam = ccy?.toUpperCase();
  const displayCurrencyParam = displayParam?.toUpperCase();
  const allMode = ccyParam === "ALL";
  const requestedDisplay = allMode ? displayCurrencyParam : ccyParam;
  const display: Currency = CURRENCIES.includes(requestedDisplay as Currency)
    ? (requestedDisplay as Currency)
    : "CAD";

  const [accounts, fxRates] = await Promise.all([
    prisma.financialAccount.findMany({
      where: { userId },
      include: {
        transactions: true,
        snapshots: true,
        holdings: true,
        investmentSnapshots: {
          select: {
            asOf: true,
            createdAt: true,
            currency: true,
            totalMinor: true,
            displayCurrency: true,
            displayTotalMinor: true,
            status: true,
          },
          orderBy: { asOf: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.fxRate.findMany({ where: { userId } }),
  ]);

  const rates: FxRateInput[] = fxRates.map((r) => ({
    base: r.base as Currency,
    quote: r.quote as Currency,
    rate: Number(r.rate),
    asOf: r.asOf.toISOString(),
  }));

  const balanceRows = accounts.map((a) => {
    const snapshots = a.snapshots.map((s) => ({
      balanceMinor: s.balanceMinor,
      currency: s.currency as Currency,
      asOf: s.asOf.toISOString(),
    }));
    const balance = accountBalanceWithCurrency(
      a.transactions.map((t) => ({
        type: t.type,
        amountMinor: t.amountMinor,
        date: t.date.toISOString(),
        currency: t.currency,
      })),
      snapshots,
      a.currency,
    );
    const valuation = holdingsValuation(
      a.holdings.map((h) => ({
        symbol: h.symbol,
        quantity: Number(h.quantity),
        lastPriceMinor: h.lastPriceMinor,
        priceCurrency: h.priceCurrency,
      })),
      a.currency,
      rates,
    );

    if (!balance.ok && a.holdings.length === 0) {
      return {
        ok: false as const,
        id: a.id,
        name: a.name,
        type: a.type as string,
        institution: a.institution,
        error: balance.error,
      };
    }

    const cashMinor = balance.ok ? balance.balanceMinor : 0;
    const totalAccountMinor = cashMinor + valuation.valueMinor;

    return {
      ok: true as const,
      id: a.id,
      name: a.name,
      type: a.type as string,
      institution: a.institution,
      currency: a.currency as Currency,
      balanceMinor: totalAccountMinor,
    };
  });
  const unavailableRows = balanceRows.filter((row) => !row.ok);
  const rows = balanceRows.filter((row) => row.ok);

  let total: ReturnType<typeof netWorth> | null = null;
  let missingRate: string | null = null;
  if (unavailableRows.length === 0) {
    try {
      total = netWorth(rows, display, rates);
    } catch (e) {
      if (e instanceof MissingFxRateError) missingRate = e.message;
      else throw e;
    }
  }
  const balanceWarning =
    unavailableRows.length > 0
      ? `Balance unavailable for ${unavailableRows.map((row) => row.name).join(", ")}. Add a balance snapshot before net worth can be computed.`
      : null;

  const todayDate = new Date();
  const today = todayDate.toISOString().slice(0, 10);
  const history = buildNetWorthHistory(
    accounts.map((account) => ({
      id: account.id,
      name: account.name,
      trackingFrom: account.createdAt.toISOString(),
      hasSetupData:
        account.holdings.length > 0 ||
        account.transactions.length > 0 ||
        account.snapshots.length > 0,
      snapshots: account.investmentSnapshots.map((snapshot) => ({
        asOf: snapshot.asOf.toISOString(),
        capturedAt: snapshot.createdAt.toISOString(),
        currency: snapshot.currency as Currency,
        totalMinor: snapshot.totalMinor,
        displayCurrency: snapshot.displayCurrency as Currency,
        displayTotalMinor: snapshot.displayTotalMinor,
        status: snapshot.status,
      })),
    })),
    display,
    rates,
    todayDate,
  );

  const [profile, dismissals, bills, dueCards] = await Promise.all([
    getOrCreateProfile(userId),
    prisma.alert.findMany({ where: { userId }, select: { ruleKey: true, entityRef: true } }),
    prisma.bill.findMany({ where: { userId }, include: { payments: true } }),
    prisma.creditCard.findMany({
      where: { userId, dueDay: { not: null } },
      select: { id: true, nickname: true, dueDay: true },
    }),
  ]);
  const in14 = new Date(todayDate.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
  const billEntries = bills.flatMap((b) =>
    billOccurrences(
      {
        id: b.id,
        name: b.name,
        category: b.category,
        currency: b.currency,
        autopay: b.autopay,
        variable: b.variable,
        cadence: b.cadence as unknown as Cadence,
        schedule: b.schedule as unknown as ScheduleEntry[],
      },
      today,
      in14,
    ).map((o) => ({
      ...o,
      paid: b.payments.some((p) => p.dueDate.toISOString().slice(0, 10) === o.date && p.paidAt),
    })),
  );
  const cardEntries = dueCards.flatMap((c) => {
    const [yearNow, monthNow] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
    const candidates = [0, 1].map((offset) => {
      const monthIndex = monthNow + offset;
      const month = monthIndex > 12 ? 1 : monthIndex;
      const year = monthIndex > 12 ? yearNow + 1 : yearNow;
      return `${year}-${String(month).padStart(2, "0")}-${String(c.dueDay).padStart(2, "0")}`;
    });
    const next = candidates.find((d) => d >= today && d <= in14);
    return next
      ? [
          {
            billId: `card-${c.id}`,
            billName: `💳 ${c.nickname} payment`,
            date: next,
            amountMinor: 0,
            currency: "CAD",
            autopay: false,
            variable: false,
            paid: false,
          },
        ]
      : [];
  });
  const upcoming = [...billEntries, ...cardEntries].sort((a, b) => (a.date < b.date ? -1 : 1));

  const snapshotForRules = await buildSnapshot(userId, today);
  const { alerts } = evaluateRules(profile, snapshotForRules, ALL_RULES);
  const { active } = applyDismissals(alerts, dismissals);

  // Prepared drawer data
  const drawerAccounts: DrawerAccountItem[] = accounts.map((a) => {
    const matchingTotal = total?.perAccount.find((pa) => pa.id === a.id);
    const balanceRow = balanceRows.find((br) => br.id === a.id);

    if (matchingTotal) {
      return {
        id: a.id,
        name: a.name,
        type: a.type as string,
        institution: a.institution,
        currency: a.currency as Currency,
        balanceMinor: matchingTotal.balanceMinor,
        displayMinor: matchingTotal.displayMinor,
        ok: true,
      };
    }

    if (balanceRow?.ok) {
      return {
        id: a.id,
        name: a.name,
        type: a.type as string,
        institution: a.institution,
        currency: balanceRow.currency,
        balanceMinor: balanceRow.balanceMinor,
        ok: true,
      };
    }

    return {
      id: a.id,
      name: a.name,
      type: a.type as string,
      institution: a.institution,
      ok: false,
      error: balanceRow && !balanceRow.ok ? balanceRow.error : "Balance unavailable",
    };
  });

  const drawerBills: DrawerBillItem[] = upcoming.map((o) => ({
    billId: o.billId,
    billName: o.billName,
    date: o.date,
    amountMinor: o.amountMinor,
    currency: o.currency,
    autopay: o.autopay,
    paid: o.paid,
  }));

  const drawerAlerts: DrawerAlertItem[] = active.map((a) => ({
    ruleKey: a.ruleKey,
    entityRef: a.entityRef,
    title: a.title,
    action: a.action,
    severity: a.severity as "critical" | "warning" | "info",
  }));

  return (
    <main className="space-y-5 py-5 sm:py-7">
      {/* Minimal Top Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{user.email}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SignOutButton redirectUrl="/login">
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border/80 bg-background px-3 text-xs font-medium text-muted-foreground shadow-2xs transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
            >
              <LogOut className="size-3.5" />
              <span>Sign out</span>
            </button>
          </SignOutButton>
        </div>
      </header>

      {/* Prominent Hero Net Worth Section */}
      <Card className="relative overflow-hidden border-border/90 bg-gradient-to-b from-card to-muted/15 shadow-sm">
        <CardHeader className="flex flex-col gap-4 pb-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {allMode ? `Net worth (all currencies, ${display})` : `Net worth (${display})`}
            </h2>
            {total ? (
              <div className="flex items-baseline gap-2.5">
                <span className="text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">
                  {formatMinorUnits(total.totalMinor, display)}
                </span>
                <Badge variant="outline" className="text-[11px] font-medium uppercase tracking-wide">
                  {display}
                </Badge>
              </div>
            ) : (
              <p className="text-sm text-red-600 font-medium">
                {balanceWarning ?? missingRate}
                {missingRate ? (
                  <>
                    {" "}
                    <Link href="/investments/import" className="underline font-medium hover:text-red-700">
                      Add an FX rate via import
                    </Link>
                    .
                  </>
                ) : null}
              </p>
            )}
          </div>

          {/* Currency Switcher & FX Controls */}
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="flex flex-wrap items-center gap-1.5">
              <nav
                aria-label="Net worth currency mode"
                className="flex items-center gap-0.5 rounded-lg border border-border/80 bg-muted/40 p-1 text-xs shadow-2xs"
              >
                <Link
                  href={`/?ccy=ALL&display=${display}`}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-medium transition-colors",
                    allMode
                      ? "bg-foreground text-background shadow-2xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  All
                </Link>
                {CURRENCIES.map((c) => (
                  <Link
                    key={c}
                    href={`/?ccy=${c}`}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium transition-colors",
                      !allMode && c === display
                        ? "bg-foreground text-background shadow-2xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {c}
                  </Link>
                ))}
              </nav>

              <form action={refreshFxRates}>
                <input type="hidden" name="ccy" value={allMode ? "ALL" : display} />
                {allMode ? <input type="hidden" name="display" value={display} /> : null}
                <button
                  type="submit"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/80 bg-background px-2.5 text-xs font-medium text-muted-foreground shadow-2xs transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                  title="USD/CAD from Bank of Canada Valet (JMD stays manual)"
                >
                  <RefreshCw className="size-3" />
                  <span>↻ FX</span>
                </button>
              </form>
            </div>

            {allMode ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Display as</span>
                <nav
                  aria-label="All-currency display currency"
                  className="flex items-center gap-0.5 rounded-md border border-border/80 bg-muted/40 p-0.5 text-xs"
                >
                  {CURRENCIES.map((c) => (
                    <Link
                      key={c}
                      href={`/?ccy=ALL&display=${c}`}
                      className={cn(
                        "rounded px-2 py-0.5 font-medium transition-colors",
                        c === display
                          ? "bg-foreground text-background font-semibold"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {c}
                    </Link>
                  ))}
                </nav>
              </div>
            ) : null}

            {fxOk ? <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">✓ {fxOk}</p> : null}
            {fxError ? <p className="text-xs font-medium text-red-600">{fxError}</p> : null}
          </div>
        </CardHeader>

        <CardContent className="pt-2">
          <NetWorthHistory view={history} currency={display} />
        </CardContent>
      </Card>

      {/* Interactive Pulse Bar & Slide-Over Drawer Hub */}
      <DashboardPulseBarAndDrawer
        accounts={drawerAccounts}
        upcoming={drawerBills}
        alerts={drawerAlerts}
        display={display}
      />
    </main>
  );
}
