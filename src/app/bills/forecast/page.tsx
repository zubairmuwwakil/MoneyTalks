import Link from "next/link";
import { ArrowLeft, CalendarDays, LineChart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ForecastBars } from "@/components/forecast-bars";
import { forecastMonths, type BillDef } from "@/engine/billforecast";
import { dangerMonths } from "@/engine/dangermonth";
import { formatMinorUnits } from "@/engine/money";
import type { Cadence, ScheduleEntry } from "@/engine/recurrence";
import { projectCashCushion } from "@/engine/rules/bill-rules";
import { prisma } from "@/lib/prisma";
import { getOrCreateProfile } from "@/lib/profile";
import { requireUserId } from "@/lib/require-user";
import { buildSnapshot } from "@/lib/snapshot";
import { cn } from "@/lib/utils";

export default async function ForecastPage() {
  const userId = await requireUserId();
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
  const startMonth = new Date().toISOString().slice(0, 7);
  const forecast = forecastMonths(defs, startMonth, 12);

  const profile = await getOrCreateProfile(userId);
  const cushionActive = profile.cushionMinor > 0;
  const minBalanceByMonth = new Map<string, { minBalanceMinor: number; isDanger: boolean }>();
  if (cushionActive) {
    const today = new Date().toISOString().slice(0, 10);
    const snapshot = await buildSnapshot(userId, today);
    const { series } = projectCashCushion(profile, snapshot);
    const dangerSet = new Set(dangerMonths(series, profile.cushionMinor).map((m) => m.month));
    for (const point of series) {
      const month = point.date.slice(0, 7);
      const existing = minBalanceByMonth.get(month);
      if (!existing || point.balanceMinor < existing.minBalanceMinor) {
        minBalanceByMonth.set(month, { minBalanceMinor: point.balanceMinor, isDanger: dangerSet.has(month) });
      }
    }
  }

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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">12-month forecast</h1>
            <p className="text-sm text-muted-foreground">
              Projected monthly outflows, cumulative spend, and cash cushion health.
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <LineChart className="size-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">Monthly Outflow Trend</CardTitle>
          </div>
          <CardDescription>Estimated bill obligations for the next 12 months in CAD.</CardDescription>
        </CardHeader>
        <CardContent>
          <ForecastBars
            data={forecast.map((f) => ({ month: f.month, totalMinor: f.totalMinor }))}
            currency="CAD"
          />
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm tabular-nums">
            <thead>
              <tr className="border-b border-border/80 bg-muted/40 text-xs font-semibold text-muted-foreground">
                <th className="py-3 px-4">Month</th>
                <th className="py-3 px-4">Due</th>
                <th className="py-3 px-4">Total</th>
                <th className="py-3 px-4">Cumulative</th>
                {cushionActive ? <th className="py-3 px-4">Min balance</th> : null}
                <th className="py-3 px-4">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {forecast.map((f) => {
                const cushionInfo = minBalanceByMonth.get(f.month);
                const danger = cushionActive && (cushionInfo?.isDanger ?? false);
                const hasFlags = f.flags.length > 0 || danger;
                return (
                  <tr
                    key={f.month}
                    className={cn(
                      "transition-colors hover:bg-muted/30",
                      hasFlags ? "bg-amber-500/10 dark:bg-amber-500/15" : ""
                    )}
                  >
                    <td className="py-3 px-4 font-medium">
                      <Link href={`/bills/month?month=${f.month}`} className="font-semibold underline-offset-4 hover:underline">
                        {f.month}
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">{f.occurrences.length}</td>
                    <td className="py-3 px-4 font-semibold text-foreground">{formatMinorUnits(f.totalMinor, "CAD")}</td>
                    <td className="py-3 px-4 text-muted-foreground">{formatMinorUnits(f.cumulativeMinor, "CAD")}</td>
                    {cushionActive ? (
                      <td className="py-3 px-4">
                        {cushionInfo ? (
                          <span className={cn(danger ? "font-semibold text-amber-700 dark:text-amber-300" : "")}>
                            {formatMinorUnits(cushionInfo.minBalanceMinor, "CAD")}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    ) : null}
                    <td className="py-3 px-4 text-xs font-medium">
                      {f.flags.length > 0 ? (
                        <span className="text-amber-800 dark:text-amber-300">{f.flags.join(", ")}</span>
                      ) : danger ? (
                        <span className="text-amber-800 dark:text-amber-300">Below cash cushion</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}
