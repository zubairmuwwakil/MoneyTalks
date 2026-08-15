import Link from "next/link";
import { ForecastBars } from "@/components/forecast-bars";
import { forecastMonths, type BillDef } from "@/engine/billforecast";
import type { Cadence, ScheduleEntry } from "@/engine/recurrence";
import { formatMinorUnits } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export default async function ForecastPage() {
  const userId = await requireUserId();
  const bills = await prisma.bill.findMany({ where: { userId } });
  const defs: BillDef[] = bills.map((b) => ({
    id: b.id, name: b.name, category: b.category, currency: b.currency,
    autopay: b.autopay, variable: b.variable,
    cadence: b.cadence as unknown as Cadence,
    schedule: b.schedule as unknown as ScheduleEntry[],
  }));
  const startMonth = new Date().toISOString().slice(0, 7);
  const forecast = forecastMonths(defs, startMonth, 12);

  return (
    <main className="space-y-6 py-8">
      <h1 className="text-xl font-semibold">12-month forecast</h1>
      <ForecastBars
        data={forecast.map((f) => ({ month: f.month, totalMinor: f.totalMinor }))}
        currency="CAD"
      />
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Month</th><th>Due</th><th>Total</th><th>Cumulative</th><th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {forecast.map((f) => (
            <tr key={f.month} className={`border-b ${f.flags.length > 0 ? "bg-amber-500/10" : ""}`}>
              <td className="py-2">
                <Link href={`/bills/month?month=${f.month}`} className="underline">{f.month}</Link>
              </td>
              <td>{f.occurrences.length}</td>
              <td>{formatMinorUnits(f.totalMinor, "CAD")}</td>
              <td>{formatMinorUnits(f.cumulativeMinor, "CAD")}</td>
              <td className="text-xs">{f.flags.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
