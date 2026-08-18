import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Info,
  LogOut,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Wallet,
} from "lucide-react";
import { SignOutButton } from "@clerk/nextjs";
import { refreshFxRates } from "@/app/actions/refresh";
import { NetWorthSparkline } from "@/components/net-worth-sparkline";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { accountBalanceWithCurrency } from "@/engine/balance";
import { billOccurrences } from "@/engine/billforecast";
import { MissingFxRateError, type FxRateInput } from "@/engine/fx";
import { formatMinorUnits, type Currency } from "@/engine/money";
import { netWorth, netWorthSeries, type SnapshotRow } from "@/engine/networth";
import type { Cadence, ScheduleEntry } from "@/engine/recurrence";
import { ALL_RULES, applyDismissals, evaluateRules } from "@/engine/rules";
import { prisma } from "@/lib/prisma";
import { getOrCreateProfile } from "@/lib/profile";
import { getOptionalUser } from "@/lib/require-user";
import { MarketingContent } from "@/components/marketing/marketing-content";
import { buildSnapshot } from "@/lib/snapshot";
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
      include: { transactions: true, snapshots: true },
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
    if (!balance.ok) {
      return {
        ok: false as const,
        id: a.id,
        name: a.name,
        type: a.type as string,
        institution: a.institution,
        error: balance.error,
      };
    }
    return {
      ok: true as const,
      id: a.id,
      name: a.name,
      type: a.type as string,
      institution: a.institution,
      currency: balance.currency as Currency,
      balanceMinor: balance.balanceMinor,
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

  const snapshotRows: SnapshotRow[] = accounts.flatMap((a) =>
    a.snapshots.map((s) => ({
      accountId: a.id,
      balanceMinor: s.balanceMinor,
      currency: s.currency as Currency,
      asOf: s.asOf.toISOString(),
    })),
  );
  const todayDate = new Date();
  const today = todayDate.toISOString().slice(0, 10);
  const from = new Date(todayDate.getTime() - 89 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  let series: Array<{ date: string; totalMinor: number }> = [];
  try {
    series = netWorthSeries(snapshotRows, display, rates, from, today);
  } catch {
    // Missing FX rate for a historical snapshot: the optional sparkline is unavailable.
  }

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
  const topAlerts = active.slice(0, 3);

  return (
    <main className="space-y-8 py-6 sm:py-8">
      {/* Top Header / Account Status Bar */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{user.email}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <SignOutButton redirectUrl="/login">
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/80 bg-background px-3 text-xs font-medium text-muted-foreground shadow-2xs transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOut className="size-3.5" />
              <span>Sign out</span>
            </button>
          </SignOutButton>
        </div>
      </header>

      {/* Hero Net Worth Card */}
      <Card className="relative overflow-hidden border-border/90 bg-gradient-to-b from-card to-muted/20 shadow-xs">
        <CardHeader className="flex flex-col gap-4 pb-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {allMode ? `Net worth (all currencies, ${display})` : `Net worth (${display})`}
            </h2>
            {total ? (
              <div className="flex items-baseline gap-2">
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
                        c === display ? "bg-foreground text-background font-semibold" : "text-muted-foreground hover:text-foreground"
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
          <NetWorthSparkline data={series} currency={display} />
        </CardContent>
      </Card>

      {/* Accounts Breakdown Grid */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="size-4 text-muted-foreground" />
            <h2 className="text-base font-semibold tracking-tight">Accounts & Balances</h2>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/investments/import"
              className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Import
            </Link>
            <span className="text-muted-foreground/40">·</span>
            <Link
              href="/investments/new"
              className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              + Add account
            </Link>
          </div>
        </div>

        {accounts.length === 0 ? (
          <Card className="border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No accounts yet —{" "}
              <Link href="/investments/new" className="font-medium text-foreground underline">
                add an account
              </Link>{" "}
              or{" "}
              <Link href="/investments/import" className="font-medium text-foreground underline">
                import your data
              </Link>
              .
            </p>
          </Card>
        ) : total ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {total.perAccount.map((a) => (
              <Link
                key={a.id}
                href={`/investments/${a.id}`}
                className="group relative flex flex-col justify-between rounded-xl border border-border/80 bg-card p-4 shadow-2xs transition-all hover:border-foreground/30 hover:shadow-xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-foreground group-hover:text-primary">{a.name}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px] font-medium">
                        {a.type}
                      </Badge>
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </div>
                <div className="mt-3 flex items-baseline justify-between border-t border-border/40 pt-2.5">
                  <span className="text-xs text-muted-foreground">Calculated balance</span>
                  <p className="text-base font-semibold tabular-nums text-foreground">
                    {formatMinorUnits(a.displayMinor, display)}
                    {a.currency !== display ? (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        ({formatMinorUnits(a.balanceMinor, a.currency)} {a.currency})
                      </span>
                    ) : null}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {rows.map((a) => (
                <Link
                  key={a.id}
                  href={`/investments/${a.id}`}
                  className="group flex flex-col justify-between rounded-xl border border-border/80 bg-card p-4 shadow-2xs transition-all hover:border-foreground/30 hover:shadow-xs"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-foreground group-hover:text-primary">{a.name}</p>
                      <Badge variant="secondary" className="mt-1 text-[10px]">
                        {a.type}
                      </Badge>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground/50 group-hover:text-foreground" />
                  </div>
                  <div className="mt-3 flex items-baseline justify-between border-t border-border/40 pt-2.5">
                    <span className="text-xs text-muted-foreground">Native balance</span>
                    <p className="text-base font-semibold tabular-nums">
                      {formatMinorUnits(a.balanceMinor, a.currency)} {a.currency}
                    </p>
                  </div>
                </Link>
              ))}
              {unavailableRows.map((a) => (
                <Link
                  key={a.id}
                  href={`/investments/${a.id}`}
                  className="group flex flex-col justify-between rounded-xl border border-red-500/30 bg-red-500/5 p-4 shadow-2xs transition-all hover:border-red-500/50"
                >
                  <div>
                    <p className="font-semibold text-foreground">{a.name}</p>
                    <Badge variant="secondary" className="mt-1 text-[10px]">
                      {a.type}
                    </Badge>
                    <p className="mt-2 text-xs font-medium text-red-600">{a.error}</p>
                  </div>
                  <div className="mt-2 flex items-center justify-end text-xs text-red-600 underline">
                    Add snapshot →
                  </div>
                </Link>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Account balances are shown in their native currencies until an FX rate is available.
            </p>
          </div>
        )}
      </section>

      {/* Two Column Grid: Alerts & Upcoming Bills */}
      <section className="grid gap-4 sm:grid-cols-2">
        {/* Alerts & Opportunities Card */}
        <Card className="flex flex-col justify-between">
          <div>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Alerts &amp; opportunities</CardTitle>
              </div>
              <Link
                href="/money-finder"
                className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                all ({active.length})
              </Link>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {topAlerts.map((a) => (
                  <li
                    key={`${a.ruleKey}:${a.entityRef}`}
                    className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-muted/30 p-2.5 transition-colors hover:bg-muted/50"
                  >
                    <div className="mt-0.5 shrink-0">
                      {a.severity === "critical" ? (
                        <ShieldAlert className="size-4 text-red-600" />
                      ) : a.severity === "warning" ? (
                        <AlertTriangle className="size-4 text-amber-600" />
                      ) : (
                        <Info className="size-4 text-sky-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground text-xs leading-snug truncate">{a.title}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{a.action}</p>
                    </div>
                  </li>
                ))}
                {topAlerts.length === 0 ? (
                  <li className="py-4 text-center text-xs text-muted-foreground">All clear. No active alerts.</li>
                ) : null}
              </ul>
            </CardContent>
          </div>
          {active.length > 0 ? (
            <div className="border-t border-border/60 px-5 py-2.5">
              <Link
                href="/money-finder"
                className="flex items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <span>View all compliance &amp; tax rules</span>
                <ArrowRight className="size-3" />
              </Link>
            </div>
          ) : null}
        </Card>

        {/* Next 14 Days Cashflow Card */}
        <Card className="flex flex-col justify-between">
          <div>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div className="flex items-center gap-2">
                <Calendar className="size-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Next 14 days</CardTitle>
              </div>
              <Link
                href="/bills"
                className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                bills
              </Link>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm tabular-nums">
                {upcoming.map((o) => (
                  <li
                    key={`${o.billId}:${o.date}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 p-2.5 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 text-xs font-medium text-muted-foreground">{o.date.slice(5)}</span>
                      <span className="truncate text-xs font-medium text-foreground">{o.billName}</span>
                      {o.autopay ? (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                          auto
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-foreground">
                      <span>{o.amountMinor === 0 ? "—" : formatMinorUnits(o.amountMinor, o.currency as Currency)}</span>
                      {o.paid ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : null}
                    </div>
                  </li>
                ))}
                {upcoming.length === 0 ? (
                  <li className="py-4 text-center text-xs text-muted-foreground">Nothing due in the next 14 days.</li>
                ) : null}
              </ul>
            </CardContent>
          </div>
          {upcoming.length > 0 ? (
            <div className="border-t border-border/60 px-5 py-2.5">
              <Link
                href="/bills/forecast"
                className="flex items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <span>View 12-month bill forecast</span>
                <ArrowRight className="size-3" />
              </Link>
            </div>
          ) : null}
        </Card>
      </section>
    </main>
  );
}
