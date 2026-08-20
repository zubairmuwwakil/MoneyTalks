"use client";

import Link from "next/link";
import { ArrowRight, CalendarRange, TriangleAlert } from "lucide-react";
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
import type { BillImpactView } from "@/lib/domain/bills/billImpact";

function shortWeek(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

export function BillImpactWorkspace({ view }: { view: BillImpactView }) {
  const fxDateCopy = view.fxOldestAsOf
    ? view.fxOldestAsOf === view.fxLatestAsOf
      ? `FX rate used: ${view.fxOldestAsOf.slice(0, 10)}`
      : `FX rates used: ${view.fxOldestAsOf.slice(0, 10)}–${view.fxLatestAsOf?.slice(0, 10)}`
    : null;

  return (
    <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-2xs" aria-labelledby="bill-impact-title">
      <div className="flex flex-col gap-5 border-b border-border/70 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div>
          <div className="flex items-center gap-2">
            <CalendarRange className="size-4 text-muted-foreground" />
            <p id="bill-impact-title" className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Next 8 weeks
            </p>
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">
              {formatMinorUnits(view.totalMinor, "CAD")}
            </p>
            <span className="text-xs font-semibold text-muted-foreground">
              {formatMinorUnits(view.averageMinor, "CAD")} average per week
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Scheduled obligations from {view.startDate} · variable amounts remain estimates
          </p>
        </div>

        <div className="sm:text-right">
          {view.busiestWeek ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Highest-pressure week</p>
              <p className="mt-1 text-sm font-semibold tabular-nums">
                {shortWeek(view.busiestWeek.weekStart)} · {formatMinorUnits(view.busiestWeek.totalMinor, "CAD")}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No scheduled amounts in this window</p>
          )}
        </div>
      </div>

      <div className="px-3 py-5 sm:px-5">
        <div className="h-52 w-full" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={view.weeks} margin={{ top: 12, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
              <XAxis
                dataKey="weekStart"
                tickFormatter={shortWeek}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                interval={0}
              />
              <YAxis hide domain={[0, "auto"]} />
              <ReferenceLine
                y={view.averageMinor}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                ifOverflow="extendDomain"
              />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const week = payload[0]?.payload as (typeof view.weeks)[number] | undefined;
                  if (!week) return null;
                  return (
                    <div className="rounded-lg border border-border/80 bg-background/95 p-3 text-xs shadow-md backdrop-blur-xs">
                      <p className="font-semibold">Week of {shortWeek(String(label))}</p>
                      <p className="mt-1 text-muted-foreground">Fixed {formatMinorUnits(week.fixedMinor, "CAD")}</p>
                      {week.variableMinor > 0 ? (
                        <p className="text-amber-700 dark:text-amber-300">Variable estimate {formatMinorUnits(week.variableMinor, "CAD")}</p>
                      ) : null}
                      <p className="mt-1 font-semibold">{week.occurrenceCount} due · {formatMinorUnits(week.totalMinor, "CAD")}</p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="fixedMinor" stackId="outflow" fill="var(--chart-5)" radius={[0, 0, 4, 4]} maxBarSize={42} />
              <Bar dataKey="variableMinor" stackId="outflow" fill="#d97706" radius={[5, 5, 0, 0]} maxBarSize={42} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <table className="sr-only">
          <caption>Weekly fixed and estimated variable bill obligations in Canadian dollars</caption>
          <thead><tr><th>Week</th><th>Fixed</th><th>Variable estimate</th><th>Total</th></tr></thead>
          <tbody>
            {view.weeks.map((week) => (
              <tr key={week.weekStart}>
                <th>{week.weekStart}</th>
                <td>{formatMinorUnits(week.fixedMinor, "CAD")}</td>
                <td>{formatMinorUnits(week.variableMinor, "CAD")}</td>
                <td>{formatMinorUnits(week.totalMinor, "CAD")}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-2 flex flex-col gap-3 px-2 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-foreground" /> Fixed</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-amber-600" /> Variable estimate</span>
            {view.excludedCount > 0 ? (
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                <TriangleAlert className="size-3" />
                {view.excludedCount} occurrence{view.excludedCount === 1 ? "" : "s"} omitted for missing currency/FX
              </span>
            ) : fxDateCopy ? (
              <span>{fxDateCopy}</span>
            ) : null}
          </div>
          <Link href="/bills/forecast" className="inline-flex shrink-0 items-center gap-1 font-semibold text-foreground hover:underline hover:underline-offset-4">
            View 12-month forecast <ArrowRight className="size-3" />
          </Link>
        </div>
      </div>
    </section>
  );
}
