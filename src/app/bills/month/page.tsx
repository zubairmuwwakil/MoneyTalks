import Link from "next/link";
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { forecastMonths, type BillDef } from "@/engine/billforecast";
import { formatMinorUnits, type Currency } from "@/engine/money";
import type { Cadence, ScheduleEntry } from "@/engine/recurrence";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export default async function MonthViewPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const userId = await requireUserId();
  const { month: monthParam } = await searchParams;
  const month =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam)
      ? monthParam
      : new Date().toISOString().slice(0, 7);

  const bills = await prisma.bill.findMany({ where: { userId } });
  const defs: BillDef[] = bills.map((b) => ({
    id: b.id,
    name: b.name,
    category: b.category,
    currency: b.currency,
    autopay: b.autopay,
    variable: b.variable,
    cadence: b.cadence as unknown as Cadence,
    schedule: b.schedule as unknown as ScheduleEntry[],
  }));
  const [forecast] = forecastMonths(defs, month, 1);

  const [y, m] = month.split("-").map(Number);
  const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;

  const rows = forecast.occurrences.map((occurrence, i, all) => ({
    occurrence,
    runningMinor: all.slice(0, i + 1).reduce((sum, o) => sum + o.amountMinor, 0),
  }));

  return (
    <main className="space-y-6 py-6 sm:py-8">
      <div>
        <Link
          href="/bills"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to Bills</span>
        </Link>
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold tracking-tight">{month} Schedule</h1>
          <nav className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/bills/month?month=${prev}`} className="flex items-center gap-1">
                <ChevronLeft className="size-3.5" />
                <span>{prev}</span>
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/bills/month?month=${next}`} className="flex items-center gap-1">
                <span>{next}</span>
                <ChevronRight className="size-3.5" />
              </Link>
            </Button>
          </nav>
        </header>
      </div>

      {forecast.flags.length > 0 ? (
        <div
          data-testid="pileup-flag"
          className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs font-medium text-amber-800 dark:text-amber-300"
        >
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">⚠ Pileup month: {forecast.flags.join(", ")}</p>
            <p className="mt-0.5 text-amber-700 dark:text-amber-400">
              Multiple occurrences of recurring expenses land in this monthly cycle. Plan cashflow accordingly.
            </p>
          </div>
        </div>
      ) : null}

      <div className="space-y-4">
        <ul className="divide-y divide-border/60 rounded-xl border border-border/80 bg-card shadow-2xs overflow-hidden">
          {rows.map(({ occurrence: o, runningMinor }) => (
            <li key={`${o.billId}:${o.date}`} className="flex items-center justify-between px-5 py-3.5 text-sm tabular-nums transition-colors hover:bg-muted/30">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">{o.date}</span>
                <Link href={`/bills/${o.billId}`} className="font-semibold text-foreground underline-offset-4 hover:underline">
                  {o.billName}
                </Link>
                {o.autopay ? (
                  <Badge variant="secondary" className="text-[10px]">
                    autopay
                  </Badge>
                ) : null}
              </div>
              <div className="flex items-center gap-4 text-right">
                <span className="font-semibold text-foreground">
                  {formatMinorUnits(o.amountMinor, o.currency as Currency)}
                </span>
                <span className="text-xs text-muted-foreground font-medium">
                  Σ {formatMinorUnits(runningMinor, "CAD")}
                </span>
              </div>
            </li>
          ))}
          {forecast.occurrences.length === 0 ? (
            <li className="px-5 py-8 text-center text-xs text-muted-foreground">
              No bills due this month.
            </li>
          ) : null}
        </ul>

        <div className="flex justify-end rounded-xl border border-border/80 bg-muted/30 px-6 py-4">
          <div className="text-right">
            <span className="text-xs text-muted-foreground block">Month Total Outflow</span>
            <p className="text-xl font-bold tabular-nums text-foreground">
              Total: {formatMinorUnits(forecast.totalMinor, "CAD")}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
