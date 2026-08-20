"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowDownRight, ArrowUpRight, ChevronRight, Info } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { formatMinorUnits, type Currency } from "@/engine/money";
import type {
  PerformanceRange,
  PerformanceWorkspaceView,
} from "@/lib/domain/investments/performanceReadModel";
import { formatSignedMinor, formatSignedPercent } from "./performance-format";
import { PerformanceSparkline } from "./performance-sparkline";

const RANGES: PerformanceRange[] = ["1M", "3M", "YTD", "1Y", "ALL"];

export type InvestmentAccountMeta = {
  id: string;
  type: string;
  institution: string;
  country: string;
  isUSSitus: boolean;
  holdingCount: number;
  fallbackCurrentValueMinor: number | null;
  cashMinor: number | null;
};

type ChartPoint = {
  date: string;
  valueMinor: number;
  externalFlowMinor: number;
  netInvestedMinor: number;
  gainMinor: number | null;
  dailyReturn: number | null;
};

function readableDate(date: string): string {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00.000Z`),
  );
}

function axisDate(date: string): string {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00.000Z`),
  );
}

function compactMoney(valueMinor: number, currency: Currency): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(valueMinor / 100);
}

function tone(value: number | null): string {
  if (value === null || value === 0) return "text-foreground";
  return value > 0
    ? "text-emerald-700 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400";
}

function chartPoints(view: PerformanceWorkspaceView, accountId: string | null): ChartPoint[] {
  const summary = accountId
    ? view.accounts.find((account) => account.id === accountId)?.summary
    : view.portfolio;
  if (!summary || summary.series.length === 0) return [];

  let netInvestedMinor = summary.series[0].valueMinor;
  return summary.series.map((point, index) => {
    if (index > 0) netInvestedMinor += point.externalFlowMinor;
    return { ...point, netInvestedMinor };
  });
}

export function PerformanceWorkspace({
  views,
  accounts,
  fallbackPortfolioValueMinor,
}: {
  views: Record<PerformanceRange, PerformanceWorkspaceView>;
  accounts: InvestmentAccountMeta[];
  fallbackPortfolioValueMinor: number | null;
}) {
  const [range, setRange] = useState<PerformanceRange>("1M");
  const [accountId, setAccountId] = useState<string | null>(null);
  const view = views[range];
  const accountView = accountId
    ? view.accounts.find((account) => account.id === accountId) ?? null
    : null;
  const accountMeta = accountId ? accounts.find((account) => account.id === accountId) ?? null : null;
  const summary = accountView?.summary ?? view.portfolio;
  const currency = accountView?.currency ?? "CAD";
  const scopeName = accountView?.name ?? "Portfolio";
  const fallbackValue = accountMeta?.fallbackCurrentValueMinor ?? fallbackPortfolioValueMinor;
  const headlineValue = summary.endValueMinor ?? fallbackValue;
  const movers = accountView?.movers ?? view.movers;
  const data = useMemo(() => chartPoints(view, accountId), [view, accountId]);
  const hasReturn = summary.twr !== null;

  return (
    <div className="space-y-7">
      <section
        aria-labelledby="performance-heading"
        className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-2xs"
      >
        <div className="border-b border-border/70 px-5 py-5 sm:px-7 sm:py-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p id="performance-heading" className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {scopeName} value
                </p>
                {summary.endDate ? (
                  <span className="text-[11px] text-muted-foreground">through {readableDate(summary.endDate)}</span>
                ) : null}
              </div>
              <p className="mt-2 text-4xl font-bold tracking-[-0.04em] tabular-nums sm:text-5xl">
                {headlineValue === null ? "—" : formatMinorUnits(headlineValue, currency)}
              </p>
              <div className="mt-2 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                {summary.lastCloseGainMinor !== null ? (
                  <span className={`inline-flex items-center gap-1 font-semibold tabular-nums ${tone(summary.lastCloseGainMinor)}`}>
                    {summary.lastCloseGainMinor >= 0 ? (
                      <ArrowUpRight className="size-3.5" aria-hidden="true" />
                    ) : (
                      <ArrowDownRight className="size-3.5" aria-hidden="true" />
                    )}
                    {formatSignedMinor(summary.lastCloseGainMinor, currency)} · {formatSignedPercent(summary.lastCloseReturn)} last close
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {summary.endValueMinor === null
                      ? "Daily performance tracking starts after the next complete close."
                      : "One complete valuation recorded. Return appears after the next close."}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row lg:items-end">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Scope
                <select
                  value={accountId ?? "portfolio"}
                  onChange={(event) => setAccountId(event.target.value === "portfolio" ? null : event.target.value)}
                  className="mt-1 block h-9 min-w-44 rounded-lg border border-input bg-background px-3 text-xs font-semibold text-foreground shadow-2xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="portfolio">Portfolio</option>
                  {view.accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
              </label>
              <div className="flex h-9 items-center rounded-lg bg-muted/70 p-1" aria-label="Performance period">
                {RANGES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={range === option}
                    onClick={() => setRange(option)}
                    className="h-7 rounded-md px-2.5 text-[11px] font-semibold text-muted-foreground transition-all hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {option === "ALL" ? "All" : option}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-1 border-y border-border/70 sm:grid-cols-3 sm:divide-x sm:divide-border/70">
            <div className="py-3 sm:pr-5">
              <dt className="text-[11px] font-medium text-muted-foreground">Investment gain</dt>
              <dd className={`mt-1 text-lg font-semibold tabular-nums ${tone(summary.gainMinor)}`}>
                {formatSignedMinor(summary.gainMinor, currency)}
              </dd>
            </div>
            <div className="border-t border-border/70 py-3 sm:border-t-0 sm:px-5">
              <dt className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                Time-weighted return
                <span title="Deposits and withdrawals are removed. Dividends, interest, fees, and currency movement remain in performance.">
                  <Info className="size-3" aria-hidden="true" />
                </span>
              </dt>
              <dd className={`mt-1 text-lg font-semibold tabular-nums ${tone(summary.twr)}`}>
                {formatSignedPercent(summary.twr)}
              </dd>
            </div>
            <div className="border-t border-border/70 py-3 sm:border-t-0 sm:pl-5">
              <dt className="text-[11px] font-medium text-muted-foreground">Net contributions</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                {formatSignedMinor(summary.series.length > 1 ? summary.netFlowMinor : null, currency)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="min-w-0 px-3 py-5 sm:px-6">
            {data.length >= 2 ? (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-4 px-1 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-foreground" />Value</span>
                  <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-muted-foreground" />Net invested</span>
                  <span>Dots mark contributions and withdrawals</span>
                </div>
                <div className="h-72 w-full sm:h-80" aria-hidden="true">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: 4 }}>
                      <defs>
                        <linearGradient id="investment-value-fill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--foreground)" stopOpacity={0.14} />
                          <stop offset="95%" stopColor="var(--foreground)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 5" />
                      <XAxis
                        dataKey="date"
                        axisLine={false}
                        tickLine={false}
                        minTickGap={36}
                        tickFormatter={axisDate}
                        tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        width={62}
                        tickFormatter={(value) => compactMoney(Number(value), currency)}
                        tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                        domain={["auto", "auto"]}
                      />
                      <Tooltip
                        cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3", strokeOpacity: 0.5 }}
                        content={({ active, payload }) => {
                          const point = payload?.[0]?.payload as ChartPoint | undefined;
                          if (!active || !point) return null;
                          return (
                            <div className="min-w-52 rounded-xl border border-border/80 bg-popover/95 p-3 text-xs shadow-lg backdrop-blur-sm">
                              <p className="font-semibold text-foreground">{readableDate(point.date)}</p>
                              <dl className="mt-2 space-y-1.5">
                                <div className="flex justify-between gap-5"><dt className="text-muted-foreground">Value</dt><dd className="font-semibold tabular-nums">{formatMinorUnits(point.valueMinor, currency)}</dd></div>
                                <div className="flex justify-between gap-5"><dt className="text-muted-foreground">Net invested</dt><dd className="tabular-nums">{formatMinorUnits(point.netInvestedMinor, currency)}</dd></div>
                                <div className="flex justify-between gap-5"><dt className="text-muted-foreground">Investment gain</dt><dd className={`font-medium tabular-nums ${tone(point.gainMinor)}`}>{formatSignedMinor(point.gainMinor, currency)}</dd></div>
                                <div className="flex justify-between gap-5"><dt className="text-muted-foreground">Daily return</dt><dd className={`font-medium tabular-nums ${tone(point.dailyReturn)}`}>{formatSignedPercent(point.dailyReturn)}</dd></div>
                                {point.externalFlowMinor !== 0 ? (
                                  <div className="flex justify-between gap-5 border-t border-border/70 pt-1.5"><dt className="text-muted-foreground">{point.externalFlowMinor > 0 ? "Contribution" : "Withdrawal"}</dt><dd className="font-medium tabular-nums">{formatSignedMinor(point.externalFlowMinor, currency)}</dd></div>
                                ) : null}
                              </dl>
                            </div>
                          );
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="netInvestedMinor"
                        stroke="var(--muted-foreground)"
                        strokeWidth={1.4}
                        strokeDasharray="5 5"
                        fill="transparent"
                        dot={false}
                        isAnimationActive
                        animationDuration={350}
                      />
                      <Area
                        type="monotone"
                        dataKey="valueMinor"
                        stroke="var(--foreground)"
                        strokeWidth={2.4}
                        fill="url(#investment-value-fill)"
                        dot={false}
                        activeDot={{ r: 4, fill: "var(--foreground)", stroke: "var(--background)", strokeWidth: 2 }}
                        isAnimationActive
                        animationDuration={450}
                      />
                      {data.filter((point) => point.externalFlowMinor !== 0).map((point) => (
                        <ReferenceDot
                          key={`${point.date}-${point.externalFlowMinor}`}
                          x={point.date}
                          y={point.valueMinor}
                          r={4}
                          fill={point.externalFlowMinor > 0 ? "#059669" : "#e11d48"}
                          stroke="var(--background)"
                          strokeWidth={2}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : (
              <div className="flex h-64 items-center justify-center border-y border-dashed border-border/80 px-6 text-center">
                <div className="max-w-sm">
                  <p className="text-sm font-semibold">Performance needs two complete daily valuations</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Tracking starts from rollout; existing holdings are not backfilled or reconstructed.
                  </p>
                </div>
              </div>
            )}

            <p className="sr-only" role="status">
              {hasReturn
                ? `${scopeName} gained ${formatSignedMinor(summary.gainMinor, currency)} with a ${formatSignedPercent(summary.twr)} time-weighted return for ${range}.`
                : `${scopeName} does not yet have enough complete valuations to calculate a time-weighted return.`}
            </p>

            {data.length > 0 ? (
              <details className="mt-3 px-1 text-xs">
                <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                  View performance data
                </summary>
                <div className="mt-3 overflow-x-auto rounded-lg border border-border/70">
                  <table className="w-full min-w-lg text-left">
                    <thead className="bg-muted/60 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2 text-right">Value</th><th className="px-3 py-2 text-right">Net invested</th><th className="px-3 py-2 text-right">Daily return</th></tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {data.map((point) => (
                        <tr key={point.date}>
                          <td className="px-3 py-2">{readableDate(point.date)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatMinorUnits(point.valueMinor, currency)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatMinorUnits(point.netInvestedMinor, currency)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatSignedPercent(point.dailyReturn)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
          </div>

          <aside className="border-t border-border/70 bg-muted/20 px-5 py-5 lg:border-l lg:border-t-0">
            <h2 className="text-sm font-semibold tracking-tight">What moved</h2>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
              Price impact only when quantity stayed unchanged.
            </p>
            {movers.length > 0 ? (
              <ul className="mt-4 divide-y divide-border/70">
                {movers.slice(0, 6).map((mover) => (
                  <li key={mover.symbol} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                    <span className="font-mono text-xs font-semibold">{mover.symbol}</span>
                    {mover.eligible ? (
                      <span className={`text-xs font-semibold tabular-nums ${tone(mover.contributionMinor)}`}>
                        {formatSignedMinor(mover.contributionMinor, "CAD")}
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium text-muted-foreground">Position changed</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 text-xs leading-5 text-muted-foreground">
                Mover details appear after two complete position snapshots.
              </p>
            )}
          </aside>
        </div>

        {view.dataHealth.needsAttention ? (
          <div id="data-health" className="flex items-start gap-2 border-t border-amber-500/20 bg-amber-500/8 px-5 py-3 text-xs text-amber-900 dark:text-amber-200 sm:px-7">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <p>
              <strong>Data incomplete:</strong> {view.dataHealth.partialAccounts.join(", ")}. Last complete values remain visible; partial days are excluded from returns. Check prices, currencies, and FX in account details.
            </p>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="accounts-heading">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 id="accounts-heading" className="text-base font-semibold tracking-tight">Accounts</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Performance uses complete daily valuations only.</p>
          </div>
          <span className="text-xs text-muted-foreground">{accounts.length} {accounts.length === 1 ? "account" : "accounts"}</span>
        </div>
        <ul className="divide-y divide-border/70 border-y border-border/70">
          {view.accounts.map((account) => {
            const meta = accounts.find((candidate) => candidate.id === account.id)!;
            const value = account.currentValueMinor ?? meta.fallbackCurrentValueMinor;
            const values = account.summary.series.map((point) => point.valueMinor);
            return (
              <li key={account.id} className="group transition-colors hover:bg-muted/35">
                <Link
                  href={`/investments/${account.id}`}
                  className="grid gap-3 px-1 py-4 sm:grid-cols-[minmax(12rem,1fr)_7rem_8rem_6rem_auto] sm:items-center sm:px-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold tracking-tight">{account.name}</span>
                      {meta.isUSSitus ? <Badge variant="warning" className="text-[9px]">US-Situs</Badge> : null}
                    </div>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {meta.type} · {meta.institution} · {meta.country}
                    </p>
                  </div>

                  <div className="hidden text-right sm:block">
                    <p className={`text-xs font-semibold tabular-nums ${tone(account.summary.gainMinor)}`}>
                      {formatSignedMinor(account.summary.gainMinor, account.currency)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{range} gain</p>
                  </div>
                  <div className="hidden text-right sm:block">
                    <p className={`text-xs font-semibold tabular-nums ${tone(account.summary.twr)}`}>
                      {formatSignedPercent(account.summary.twr)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">Time-weighted</p>
                  </div>
                  <div className="hidden justify-end sm:flex"><PerformanceSparkline values={values} /></div>

                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <div className="text-left sm:text-right">
                      {account.status === "needs-setup" ? (
                        <p className="text-xs font-semibold text-muted-foreground">Needs setup</p>
                      ) : (
                        <p className="text-sm font-semibold tabular-nums">
                          {value === null ? "—" : formatMinorUnits(value, account.currency)}
                        </p>
                      )}
                      <p className={`mt-0.5 text-[10px] font-medium ${account.status === "incomplete" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>
                        {account.status === "tracking"
                          ? account.summary.startDate ? `Tracking since ${account.summary.startDate}` : `${meta.holdingCount} holdings`
                          : account.status === "incomplete" ? "Data incomplete" : "Add cash or holdings"}
                      </p>
                      {value === null && meta.cashMinor !== null ? (
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {formatMinorUnits(meta.cashMinor, account.currency)} cash measured
                        </p>
                      ) : null}
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
