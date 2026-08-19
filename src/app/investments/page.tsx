import Link from "next/link";
import { ChevronRight, KeyRound, Plus, TrendingUp, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { accountBalanceWithCurrency } from "@/engine/balance";
import { formatMinorUnits, type Currency } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export default async function InvestmentsPage() {
  const userId = await requireUserId();
  const accounts = await prisma.financialAccount.findMany({
    where: { userId },
    include: { transactions: true, snapshots: true },
    orderBy: { name: "asc" },
  });

  return (
    <main className="space-y-6 py-6 sm:py-8">
      {/* Header with Title and Primary Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Investments</h1>
          <p className="text-sm text-muted-foreground">
            Manage your registered accounts, cash, crypto, holdings, and transactions.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/providers" className="flex items-center gap-1.5">
              <KeyRound className="size-3.5" />
              <span>Market data keys</span>
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/investments/import" className="flex items-center gap-1.5">
              <Upload className="size-3.5" />
              <span>Import</span>
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/investments/new" className="flex items-center gap-1.5">
              <Plus className="size-3.5" />
              <span>Add account</span>
            </Link>
          </Button>
        </div>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="No accounts yet"
          description="Track your registered accounts (TFSA, RRSP, RDSP, FHSA), cash, and crypto in one place."
          action={{
            label: "Add your first account",
            href: "/investments/new",
          }}
          secondaryAction={{
            label: "Import from JSON",
            href: "/investments/import",
          }}
        />
      ) : (
        <div className="space-y-4">
          <ul className="divide-y divide-border/60 rounded-xl border border-border/80 bg-card shadow-2xs overflow-hidden">
            {accounts.map((a) => {
              const snapshots = a.snapshots.map((s) => ({
                balanceMinor: s.balanceMinor,
                currency: s.currency as Currency,
                asOf: s.asOf.toISOString(),
              }));
              const balance = accountBalanceWithCurrency(
                a.transactions.map((t) => ({
                  type: t.type,
                  amountMinor: t.amountMinor,
                  date: t.date.toISOString(),
                  currency: t.currency,
                })),
                snapshots,
                a.currency,
              );
              return (
                <li key={a.id} className="transition-colors hover:bg-muted/40">
                  <Link
                    href={`/investments/${a.id}`}
                    className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground text-sm sm:text-base tracking-tight">
                          {a.name}
                        </span>
                        {a.isUSSitus ? (
                          <Badge variant="warning" className="text-[10px]">
                            US-Situs
                          </Badge>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="secondary" className="text-[10px] font-medium">
                          {a.type}
                        </Badge>
                        <span>·</span>
                        <span>{a.institution}</span>
                        <span>·</span>
                        <span>{a.country}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3">
                      {balance.ok ? (
                        <div className="text-right">
                          <p className="text-base font-semibold tabular-nums text-foreground">
                            {formatMinorUnits(balance.balanceMinor, balance.currency as Currency)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {balance.source === "snapshot"
                              ? `Snapshot as of ${balance.asOf?.slice(0, 10)}`
                              : "Derived from transactions"}
                          </p>
                        </div>
                      ) : (
                        <span className="max-w-xs text-right text-xs font-medium text-red-600">
                          {balance.error}
                        </span>
                      )}
                      <ChevronRight className="size-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </main>
  );
}
