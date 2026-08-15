import Link from "next/link";
import { signOut } from "@/auth";
import { NetWorthSparkline } from "@/components/net-worth-sparkline";
import { PasskeyRegisterButton } from "@/components/passkey-buttons";
import { accountBalance } from "@/engine/balance";
import { MissingFxRateError, type FxRateInput } from "@/engine/fx";
import { formatMinorUnits, type Currency } from "@/engine/money";
import { netWorth, netWorthSeries, type SnapshotRow } from "@/engine/networth";
import { prisma } from "@/lib/prisma";
import { requireUser, requireUserId } from "@/lib/require-user";

const CURRENCIES: Currency[] = ["CAD", "USD", "JMD"];

export default async function Home({ searchParams }: { searchParams: Promise<{ ccy?: string }> }) {
  const user = await requireUser();
  const userId = await requireUserId();
  const { ccy } = await searchParams;
  const display: Currency = CURRENCIES.includes(ccy as Currency) ? (ccy as Currency) : "CAD";

  const [accounts, fxRates] = await Promise.all([
    prisma.financialAccount.findMany({
      where: { userId },
      include: { transactions: true, snapshots: true },
      orderBy: { name: "asc" },
    }),
    prisma.fxRate.findMany({ where: { userId } }),
  ]);

  const rates: FxRateInput[] = fxRates.map((r) => ({
    base: r.base as Currency,
    quote: r.quote as Currency,
    rate: Number(r.rate),
    asOf: r.asOf.toISOString(),
  }));

  const rows = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type as string,
    currency: a.currency as Currency,
    balanceMinor: accountBalance(
      a.transactions.map((t) => ({ type: t.type, amountMinor: t.amountMinor, date: t.date.toISOString() })),
      a.snapshots.map((s) => ({ balanceMinor: s.balanceMinor, asOf: s.asOf.toISOString() })),
    ).balanceMinor,
  }));

  let total: ReturnType<typeof netWorth> | null = null;
  let missingRate: string | null = null;
  try {
    total = netWorth(rows, display, rates);
  } catch (e) {
    if (e instanceof MissingFxRateError) missingRate = e.message;
    else throw e;
  }

  const snapshotRows: SnapshotRow[] = accounts.flatMap((a) =>
    a.snapshots.map((s) => ({
      accountId: a.id,
      balanceMinor: s.balanceMinor,
      currency: a.currency as Currency,
      asOf: s.asOf.toISOString(),
    })),
  );
  const todayDate = new Date();
  const today = todayDate.toISOString().slice(0, 10);
  const from = new Date(todayDate.getTime() - 89 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  let series: Array<{ date: string; totalMinor: number }> = [];
  try {
    series = netWorthSeries(snapshotRows, display, rates, from, today);
  } catch {
    // Missing FX rate for a historical snapshot: the optional sparkline is unavailable.
  }

  return (
    <main className="space-y-8 py-8">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Signed in as {user.email}</p>
        </div>
        <nav className="flex gap-1 rounded border p-1 text-xs">
          {CURRENCIES.map((c) => (
            <Link
              key={c}
              href={`/?ccy=${c}`}
              className={`rounded px-2 py-1 ${c === display ? "bg-foreground text-background" : ""}`}
            >
              {c}
            </Link>
          ))}
        </nav>
      </header>

      <section>
        <h2 className="text-sm text-muted-foreground">Net worth ({display})</h2>
        {total ? (
          <p className="text-3xl font-semibold tabular-nums">{formatMinorUnits(total.totalMinor, display)}</p>
        ) : (
          <p className="text-sm text-red-600">
            {missingRate}. <Link href="/investments" className="underline">Add an FX rate via import</Link>.
          </p>
        )}
        <NetWorthSparkline data={series} currency={display} />
      </section>

      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No accounts yet - <Link href="/investments" className="underline">add or import them</Link>.
        </p>
      ) : total ? (
        <section className="grid gap-3 sm:grid-cols-2">
          {total.perAccount.map((a) => (
            <Link key={a.id} href={`/investments/${a.id}`} className="rounded border p-4 hover:bg-muted/50">
              <p className="text-sm font-medium">{a.name}</p>
              <p className="text-xs text-muted-foreground">{a.type}</p>
              <p className="mt-1 tabular-nums">
                {formatMinorUnits(a.displayMinor, display)}
                {a.currency !== display ? (
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({formatMinorUnits(a.balanceMinor, a.currency)} {a.currency})
                  </span>
                ) : null}
              </p>
            </Link>
          ))}
        </section>
      ) : (
        <section className="grid gap-3 sm:grid-cols-2">
          {rows.map((a) => (
            <Link key={a.id} href={`/investments/${a.id}`} className="rounded border p-4 hover:bg-muted/50">
              <p className="text-sm font-medium">{a.name}</p>
              <p className="text-xs text-muted-foreground">{a.type}</p>
              <p className="mt-1 tabular-nums">
                {formatMinorUnits(a.balanceMinor, a.currency)} {a.currency}
              </p>
            </Link>
          ))}
          <p className="text-sm text-muted-foreground">
            Account balances are shown in their native currencies until an FX rate is available.
          </p>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
          Alerts &amp; opportunities - Phase 2
        </div>
        <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
          Upcoming payments - Phase 3
        </div>
      </section>

      <div className="flex items-center gap-3">
        <PasskeyRegisterButton />
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" className="rounded border px-3 py-1 text-sm">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
