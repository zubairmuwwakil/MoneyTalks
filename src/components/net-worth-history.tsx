"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowDownRight, ArrowUpRight } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMinorUnits, type Currency } from "@/engine/money";
import {
  selectNetWorthRange,
  summarizeNetWorthRange,
  type NetWorthHistoryView,
  type NetWorthRange,
} from "@/lib/domain/net-worth/netWorthHistory";

const RANGES: NetWorthRange[] = ["1W", "1M", "3M", "YTD", "1Y", "ALL"];

export function formatSignedNetWorthChange(
  amountMinor: number | null,
  currency: Currency,
): string {
  if (amountMinor === null) return "—";
  const value = formatMinorUnits(Math.abs(amountMinor), currency);
  if (amountMinor > 0) return `+${value}`;
  if (amountMinor < 0) return `-${value}`;
  return value;
}

export function formatSignedNetWorthPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const percent = `${Math.abs(value * 100).toFixed(1)}%`;
  if (value > 0) return `+${percent}`;
  if (value < 0) return `-${percent}`;
  return percent;
}

export function netWorthPeriodLabel(range: NetWorthRange): string {
  if (range === "1W") return "1 week";
  if (range === "1M") return "1 month";
  if (range === "3M") return "3 months";
  if (range === "YTD") return "year to date";
  if (range === "1Y") return "1 year";
  return "all tracked history";
}

function readableDate(date: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function axisDate(date: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function compactMoney(valueMinor: number, currency: Currency): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(valueMinor / 100);
}

function listNames(names: string[]): string {
  return new Intl.ListFormat("en-CA", { style: "long", type: "conjunction" }).format(names);
}

function changeTone(value: number | null): string {
  if (value === null || value === 0) return "text-foreground";
  return value > 0
    ? "text-emerald-700 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400";
}

export function netWorthHistoryAnnouncement(
  view: NetWorthHistoryView,
  range: NetWorthRange,
  currency: Currency,
): string {
  const points = selectNetWorthRange(view.points, range);
  const summary = summarizeNetWorthRange(points);
  const hasChange = points.length >= 2 && summary.changeMinor !== null;
  const result = hasChange
    ? `Net worth changed ${formatSignedNetWorthChange(summary.changeMinor, currency)} (${formatSignedNetWorthPercent(summary.changePercent)}) over ${netWorthPeriodLabel(range)}, through ${readableDate(points.at(-1)!.date)}.`
    : "Daily net worth history needs two complete nightly valuations before it can show a change.";

  if (view.incompleteAccounts.length === 0) return result;
  const names = listNames(view.incompleteAccounts);
  if (hasChange) return `${result} Data is incomplete for ${names}; partial days are excluded.`;
  return view.latestCompleteAsOf
    ? `${result} Data is incomplete for ${names}; the last complete portfolio value is through ${readableDate(view.latestCompleteAsOf)}.`
    : `${result} Data is incomplete for ${names}; no complete portfolio value is available yet.`;
}

export function NetWorthHistory({
  view,
  currency,
}: {
  view: NetWorthHistoryView;
  currency: Currency;
}) {
  const [range, setRange] = useState<NetWorthRange>("1M");
  const data = useMemo(() => selectNetWorthRange(view.points, range), [range, view.points]);
  const summary = useMemo(() => summarizeNetWorthRange(data), [data]);
  const hasChange = data.length >= 2 && summary.changeMinor !== null;
  const lastDate = data.at(-1)?.date ?? view.latestCompleteAsOf;

  return (
    <section aria-label="Net worth history" className="border-t border-border/70 pt-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-h-11">
          {hasChange ? (
            <div>
              <div
                className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold tabular-nums ${changeTone(summary.changeMinor)}`}
              >
                {summary.changeMinor! >= 0 ? (
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                ) : (
                  <ArrowDownRight className="size-4" aria-hidden="true" />
                )}
                <span>{formatSignedNetWorthChange(summary.changeMinor, currency)}</span>
                <span className="text-muted-foreground">·</span>
                <span>{formatSignedNetWorthPercent(summary.changePercent)}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Over {netWorthPeriodLabel(range)}{lastDate ? ` · through ${readableDate(lastDate)}` : ""}
              </p>
            </div>
          ) : (
            <div>
              <p className="text-sm font-semibold">Tracking net worth history</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Change appears after two complete nightly valuations{lastDate ? ` · through ${readableDate(lastDate)}` : ""}.
              </p>
            </div>
          )}
        </div>

        <div
          role="group"
          className="flex h-9 w-fit items-center rounded-lg bg-muted/70 p-1"
          aria-label="Net worth history period"
        >
          {RANGES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={range === option}
              onClick={() => setRange(option)}
              className="h-7 rounded-md px-2 text-[11px] font-semibold text-muted-foreground transition-all hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:px-2.5"
            >
              {option === "ALL" ? "All" : option}
            </button>
          ))}
        </div>
      </div>

      {data.length >= 2 ? (
        <div className="mt-3 h-52 w-full" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="net-worth-history-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--foreground)" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="var(--foreground)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 5" />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                minTickGap={34}
                tickFormatter={axisDate}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={62}
                domain={["auto", "auto"]}
                tickFormatter={(value) => compactMoney(Number(value), currency)}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
              />
              <Tooltip
                cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3", strokeOpacity: 0.5 }}
                content={({ active, payload }) => {
                  const point = payload?.[0]?.payload as { date: string; totalMinor: number } | undefined;
                  if (!active || !point) return null;
                  return (
                    <div className="rounded-xl border border-border/80 bg-popover/95 p-3 text-xs shadow-lg backdrop-blur-sm">
                      <p className="font-medium text-muted-foreground">{readableDate(point.date)}</p>
                      <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                        {formatMinorUnits(point.totalMinor, currency)}
                      </p>
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="totalMinor"
                stroke="var(--foreground)"
                strokeWidth={2.4}
                fill="url(#net-worth-history-fill)"
                dot={false}
                activeDot={{ r: 4, fill: "var(--foreground)", stroke: "var(--background)", strokeWidth: 2 }}
                isAnimationActive
                animationDuration={400}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-3 flex h-36 items-center justify-center border-y border-dashed border-border/80 px-6 text-center">
          <p className="max-w-sm text-xs leading-5 text-muted-foreground">
            Nightly tracking starts from rollout. Older holdings values are not reconstructed.
          </p>
        </div>
      )}

      {view.incompleteAccounts.length > 0 ? (
        <div className="mt-3 flex items-start gap-2 bg-amber-500/8 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-200">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <p>
            <strong>History incomplete:</strong> {listNames(view.incompleteAccounts)}. Partial days are excluded; the last complete portfolio value remains visible.
          </p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-1 text-[10px] leading-4 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>Net-worth change includes deposits, withdrawals, market movement, and currency movement.</p>
        <Link href="/investments" className="w-fit font-medium text-foreground underline-offset-4 hover:underline">
          View investment performance →
        </Link>
      </div>

      <p className="sr-only" role="status">
        {netWorthHistoryAnnouncement(view, range, currency)}
      </p>
    </section>
  );
}
