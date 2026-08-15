import Link from "next/link";
import { billOccurrences, type BillDef } from "@/engine/billforecast";
import type { Cadence, ScheduleEntry } from "@/engine/recurrence";
import { formatMinorUnits, type Currency } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

function toBillDef(b: {
  id: string; name: string; category: string; currency: string; autopay: boolean;
  variable: boolean; cadence: unknown; schedule: unknown;
}): BillDef {
  return {
    id: b.id,
    name: b.name,
    category: b.category,
    currency: b.currency,
    autopay: b.autopay,
    variable: b.variable,
    cadence: b.cadence as Cadence,
    schedule: b.schedule as ScheduleEntry[],
  };
}

export default async function BillsPage() {
  const userId = await requireUserId();
  const bills = await prisma.bill.findMany({ where: { userId }, orderBy: { name: "asc" } });
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + 400 * 86_400_000).toISOString().slice(0, 10);

  const withNext = bills.map((b) => {
    const def = toBillDef(b);
    const next = billOccurrences(def, today, horizon)[0] ?? null;
    return { bill: b, next };
  });

  const categories = [...new Set(bills.map((b) => b.category))].sort();

  return (
    <main className="space-y-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Bills</h1>
        <div className="flex gap-2 text-sm">
          <Link href="/bills/month" className="rounded border px-3 py-1">Month view</Link>
          <Link href="/bills/forecast" className="rounded border px-3 py-1">Forecast</Link>
          <Link href="/bills/new" className="rounded bg-foreground px-3 py-1 text-background">Add bill</Link>
        </div>
      </div>

      {bills.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No bills yet — add one or use <Link href="/investments/import" className="underline">Import</Link>.
        </p>
      ) : (
        categories.map((category) => (
          <section key={category}>
            <h2 className="text-sm font-medium uppercase text-muted-foreground">{category}</h2>
            <ul className="mt-2 divide-y rounded border">
              {withNext
                .filter(({ bill }) => bill.category === category)
                .map(({ bill, next }) => (
                  <li key={bill.id}>
                    <Link href={`/bills/${bill.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-muted/50">
                      <span>
                        <span className="font-medium">{bill.name}</span>{" "}
                        {bill.autopay ? <span className="rounded bg-muted px-1 text-xs">autopay</span> : null}
                        {bill.variable ? <span className="ml-1 rounded bg-muted px-1 text-xs">variable</span> : null}
                      </span>
                      <span className="text-sm tabular-nums">
                        {next ? (
                          <>
                            {next.date} · {formatMinorUnits(next.amountMinor, bill.currency as Currency)}
                            {bill.variable ? " (est.)" : ""}
                          </>
                        ) : (
                          <span className="text-muted-foreground">no upcoming date</span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
