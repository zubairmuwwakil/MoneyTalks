import Link from "next/link";
import { forecastMonths, type BillDef } from "@/engine/billforecast";
import type { Cadence, ScheduleEntry } from "@/engine/recurrence";
import { formatMinorUnits, type Currency } from "@/engine/money";
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
    id: b.id, name: b.name, category: b.category, currency: b.currency,
    autopay: b.autopay, variable: b.variable,
    cadence: b.cadence as unknown as Cadence,
    schedule: b.schedule as unknown as ScheduleEntry[],
  }));
  const [forecast] = forecastMonths(defs, month, 1);

  const [y, m] = month.split("-").map(Number);
  const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;

  // Precomputed rather than accumulated inside the JSX map: the React Compiler
  // rejects mutating a captured variable during render.
  const rows = forecast.occurrences.map((occurrence, i, all) => ({
    occurrence,
    runningMinor: all.slice(0, i + 1).reduce((sum, o) => sum + o.amountMinor, 0),
  }));

  return (
    <main className="space-y-6 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{month}</h1>
        <nav className="flex gap-2 text-sm">
          <Link href={`/bills/month?month=${prev}`} className="rounded border px-3 py-1">← {prev}</Link>
          <Link href={`/bills/month?month=${next}`} className="rounded border px-3 py-1">{next} →</Link>
        </nav>
      </header>

      {forecast.flags.length > 0 ? (
        <p className="rounded border border-amber-500 p-3 text-sm" data-testid="pileup-flag">
          ⚠ Pileup month: {forecast.flags.join(", ")}
        </p>
      ) : null}

      <ul className="divide-y rounded border">
        {rows.map(({ occurrence: o, runningMinor }) => (
          <li key={`${o.billId}:${o.date}`} className="flex justify-between px-4 py-2 text-sm tabular-nums">
            <span>
              {o.date} <Link href={`/bills/${o.billId}`} className="underline">{o.billName}</Link>
              {o.autopay ? <span className="ml-1 rounded bg-muted px-1 text-xs">autopay</span> : null}
            </span>
            <span>
              {formatMinorUnits(o.amountMinor, o.currency as Currency)}
              <span className="ml-3 text-xs text-muted-foreground">Σ {formatMinorUnits(runningMinor, "CAD")}</span>
            </span>
          </li>
        ))}
        {forecast.occurrences.length === 0 ? (
          <li className="px-4 py-2 text-sm text-muted-foreground">No bills due this month.</li>
        ) : null}
      </ul>

      <p className="text-right text-lg font-semibold tabular-nums">
        Total: {formatMinorUnits(forecast.totalMinor, "CAD")}
      </p>
    </main>
  );
}
