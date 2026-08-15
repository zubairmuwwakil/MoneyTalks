import Link from "next/link";
import { accountBalance } from "@/engine/balance";
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
    <main className="py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Investments</h1>
        <div className="flex gap-2">
          <Link href="/investments/import" className="rounded border px-3 py-1 text-sm">
            Import
          </Link>
          <Link href="/investments/new" className="rounded bg-foreground px-3 py-1 text-sm text-background">
            Add account
          </Link>
        </div>
      </div>

      {accounts.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No accounts yet. Add one or import your data.
        </p>
      ) : (
        <ul className="mt-6 divide-y rounded border">
          {accounts.map((a) => {
            const balance = accountBalance(
              a.transactions.map((t) => ({ type: t.type, amountMinor: t.amountMinor, date: t.date.toISOString() })),
              a.snapshots.map((s) => ({ balanceMinor: s.balanceMinor, asOf: s.asOf.toISOString() })),
            );
            return (
              <li key={a.id}>
                <Link href={`/investments/${a.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-muted/50">
                  <span>
                    <span className="font-medium">{a.name}</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      {a.type} · {a.institution}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums">
                    {formatMinorUnits(balance.balanceMinor, a.currency as Currency)}{" "}
                    <span className="text-xs text-muted-foreground">{a.currency}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
