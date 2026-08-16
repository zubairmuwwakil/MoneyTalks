import Link from "next/link";
import {
  CalendarDays,
  ChevronRight,
  LineChart,
  Plus,
  Receipt,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { billOccurrences, type BillDef } from "@/engine/billforecast";
import { formatMinorUnits, type Currency } from "@/engine/money";
import type { Cadence, ScheduleEntry } from "@/engine/recurrence";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

function toBillDef(b: {
  id: string;
  name: string;
  category: string;
  currency: string;
  autopay: boolean;
  variable: boolean;
  cadence: unknown;
  schedule: unknown;
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
    <main className="space-y-6 py-6 sm:py-8">
      {/* Header with Title and Quick Navigation */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bills</h1>
          <p className="text-sm text-muted-foreground">
            Recurring expenses, schedule stepping, pileup warnings, and 12-month cashflow forecasts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/bills/month" className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5" />
              <span>Month view</span>
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/bills/forecast" className="flex items-center gap-1.5">
              <LineChart className="size-3.5" />
              <span>Forecast</span>
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/bills/new" className="flex items-center gap-1.5">
              <Plus className="size-3.5" />
              <span>Add bill</span>
            </Link>
          </Button>
        </div>
      </div>

      {bills.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No bills yet"
          description="Track subscriptions, utilities, rent/mortgage, and recurring debt payments."
          action={{
            label: "Add your first bill",
            href: "/bills/new",
          }}
          secondaryAction={{
            label: "Import from JSON",
            href: "/investments/import",
          }}
        />
      ) : (
        <div className="space-y-6">
          {categories.map((category) => (
            <section key={category} className="space-y-2.5">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[11px] font-semibold uppercase tracking-wider">
                  {category}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  ({withNext.filter(({ bill }) => bill.category === category).length})
                </span>
              </div>
              <ul className="divide-y divide-border/60 rounded-xl border border-border/80 bg-card shadow-2xs overflow-hidden">
                {withNext
                  .filter(({ bill }) => bill.category === category)
                  .map(({ bill, next }) => (
                    <li key={bill.id} className="transition-colors hover:bg-muted/40">
                      <Link
                        href={`/bills/${bill.id}`}
                        className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm sm:text-base tracking-tight text-foreground">
                              {bill.name}
                            </span>
                            {bill.autopay ? (
                              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                                autopay
                              </Badge>
                            ) : null}
                            {bill.variable ? (
                              <Badge variant="info" className="px-1.5 py-0 text-[10px]">
                                variable
                              </Badge>
                            ) : null}
                          </div>
                          {bill.payee ? (
                            <p className="text-xs text-muted-foreground">Payee: {bill.payee}</p>
                          ) : null}
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-3">
                          <div className="text-right">
                            {next ? (
                              <p className="text-sm font-semibold tabular-nums text-foreground">
                                {next.date} · {formatMinorUnits(next.amountMinor, bill.currency as Currency)}
                                {bill.variable ? (
                                  <span className="text-xs font-normal text-muted-foreground ml-1">(est.)</span>
                                ) : null}
                              </p>
                            ) : (
                              <span className="text-xs text-muted-foreground">no upcoming date</span>
                            )}
                          </div>
                          <ChevronRight className="size-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
                        </div>
                      </Link>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
