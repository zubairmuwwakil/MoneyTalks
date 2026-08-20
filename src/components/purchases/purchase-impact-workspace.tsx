"use client";

import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, RotateCcw, Store } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMinorUnits } from "@/engine/money";
import type {
  PurchaseImpactRangeKey,
  PurchaseImpactView,
} from "@/lib/domain/purchases/purchaseImpact";

const RANGE_LABELS: PurchaseImpactRangeKey[] = ["4W", "12W", "52W"];

function shortWeek(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

function comparisonCopy(
  deltaPct: number | null,
  incomplete: boolean,
): { label: string; className: string; icon: typeof Minus } {
  if (incomplete) {
    return { label: "Comparison withheld · incomplete data", className: "text-amber-700 dark:text-amber-300", icon: Minus };
  }
  if (deltaPct === null) {
    return { label: "No prior-period baseline", className: "text-muted-foreground", icon: Minus };
  }
  if (deltaPct > 0) {
    return { label: `${deltaPct}% above prior period`, className: "text-amber-700 dark:text-amber-300", icon: ArrowUpRight };
  }
  if (deltaPct < 0) {
    return { label: `${Math.abs(deltaPct)}% below prior period`, className: "text-emerald-700 dark:text-emerald-300", icon: ArrowDownRight };
  }
  return { label: "Level with prior period", className: "text-muted-foreground", icon: Minus };
}

export function PurchaseImpactWorkspace({ view }: { view: PurchaseImpactView }) {
  const [rangeKey, setRangeKey] = useState<PurchaseImpactRangeKey>("12W");
  const range = view.ranges[rangeKey];
  const currentIssueCount = range.excludedCount + range.missingAmountCount;
  const comparisonIssueCount = range.comparisonExcludedCount + range.comparisonMissingAmountCount;
  const comparison = comparisonCopy(range.deltaPct, currentIssueCount + comparisonIssueCount > 0);
  const ComparisonIcon = comparison.icon;
  const chartData = range.points.map((point) => ({
    ...point,
    refundChartMinor: -point.refundMinor,
  }));
  const fxDateCopy = range.fxOldestAsOf
    ? range.fxOldestAsOf === range.fxLatestAsOf
      ? `FX rate used: ${range.fxOldestAsOf.slice(0, 10)}`
      : `FX rates used: ${range.fxOldestAsOf.slice(0, 10)}–${range.fxLatestAsOf?.slice(0, 10)}`
    : null;

  return (
    <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-2xs" aria-labelledby="purchase-impact-title">
      <div className="flex flex-col gap-5 border-b border-border/70 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div>
          <p id="purchase-impact-title" className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Tracked purchase activity
          </p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">
              {formatMinorUnits(range.totalMinor, "CAD")}
            </p>
            <span className={`inline-flex items-center gap-1 text-xs font-semibold ${comparison.className}`}>
              <ComparisonIcon className="size-3.5" />
              {comparison.label}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Gross captured purchases · {formatMinorUnits(range.netMinor, "CAD")} after received refunds
          </p>
        </div>

        <div className="inline-flex w-fit rounded-lg border border-border/80 bg-muted/40 p-1" aria-label="Purchase chart range">
          {RANGE_LABELS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={rangeKey === key}
              onClick={() => setRangeKey(key)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                rangeKey === key ? "bg-background text-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0 px-3 py-5 sm:px-5">
          <div className="h-56 w-full" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
                <XAxis
                  dataKey="weekStart"
                  tickFormatter={shortWeek}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  interval={rangeKey === "52W" ? 7 : rangeKey === "12W" ? 1 : 0}
                />
                <YAxis hide />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const point = payload[0]?.payload as (typeof chartData)[number] | undefined;
                    if (!point) return null;
                    return (
                      <div className="rounded-lg border border-border/80 bg-background/95 p-3 text-xs shadow-md backdrop-blur-xs">
                        <p className="font-semibold">Week of {shortWeek(String(label))}</p>
                        <p className="mt-1 text-muted-foreground">Purchases {formatMinorUnits(point.purchaseMinor, "CAD")}</p>
                        {point.refundMinor > 0 ? (
                          <p className="text-emerald-700 dark:text-emerald-300">
                            Refunds received −{formatMinorUnits(point.refundMinor, "CAD")}
                          </p>
                        ) : null}
                      </div>
                    );
                  }}
                />
                <Bar dataKey="purchaseMinor" fill="var(--chart-5)" radius={[5, 5, 0, 0]} maxBarSize={34} />
                <Bar dataKey="refundChartMinor" fill="#059669" radius={[0, 0, 5, 5]} maxBarSize={34} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <table className="sr-only">
            <caption>Weekly tracked purchases and received refunds in Canadian dollars</caption>
            <thead><tr><th>Week</th><th>Purchases</th><th>Refunds</th></tr></thead>
            <tbody>
              {range.points.map((point) => (
                <tr key={point.weekStart}>
                  <th>{point.weekStart}</th>
                  <td>{formatMinorUnits(point.purchaseMinor, "CAD")}</td>
                  <td>{formatMinorUnits(point.refundMinor, "CAD")}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-foreground" /> Purchases</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-emerald-600" /> Refunds received</span>
            {currentIssueCount > 0 ? (
              <span>{currentIssueCount} amount{currentIssueCount === 1 ? "" : "s"} omitted; comparison withheld</span>
            ) : null}
            {comparisonIssueCount > 0 ? (
              <span>{comparisonIssueCount} prior-period amount{comparisonIssueCount === 1 ? "" : "s"} omitted; comparison withheld</span>
            ) : null}
            {currentIssueCount === 0 && comparisonIssueCount === 0 && fxDateCopy ? (
              <span>{fxDateCopy}</span>
            ) : null}
          </div>
        </div>

        <aside className="border-t border-border/70 bg-muted/15 px-5 py-5 lg:border-l lg:border-t-0" aria-label="Top purchase drivers">
          <div className="flex items-center gap-2">
            <Store className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">What drove it</h2>
          </div>
          {range.drivers.length > 0 ? (
            <ol className="mt-4 space-y-3">
              {range.drivers.map((driver, index) => (
                <li key={driver.merchant} className="flex items-start justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-muted-foreground"><span className="mr-2 font-mono text-[10px]">{index + 1}</span>{driver.merchant}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{formatMinorUnits(driver.amountMinor, "CAD")}</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
              <RotateCcw className="mt-0.5 size-3.5 shrink-0" />
              No captured purchase amounts in this range.
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
