import Link from "next/link";
import { signOut } from "@/auth";
import { refreshFxRates } from "@/app/actions/refresh";
import { NetWorthSparkline } from "@/components/net-worth-sparkline";
import { PasskeyRegisterButton } from "@/components/passkey-buttons";
import { accountBalanceWithCurrency } from "@/engine/balance";
import { billOccurrences } from "@/engine/billforecast";
import { MissingFxRateError, type FxRateInput } from "@/engine/fx";
import { formatMinorUnits, type Currency } from "@/engine/money";
import { netWorth, netWorthSeries, type SnapshotRow } from "@/engine/networth";
import type { Cadence, ScheduleEntry } from "@/engine/recurrence";
import { ALL_RULES, applyDismissals, evaluateRules } from "@/engine/rules";
import { prisma } from "@/lib/prisma";
import { getOrCreateProfile } from "@/lib/profile";
import { requireUser, requireUserId } from "@/lib/require-user";
import { buildSnapshot } from "@/lib/snapshot";

const CURRENCIES: Currency[] = ["CAD", "USD", "JMD"];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ ccy?: string; display?: string; fxOk?: string; fxError?: string }>;
}) {
  const user = await requireUser();
  const userId = await requireUserId();
  const { ccy, display: displayParam, fxOk, fxError } = await searchParams;
  const ccyParam = ccy?.toUpperCase();
  const displayCurrencyParam = displayParam?.toUpperCase();
  const allMode = ccyParam === "ALL";
  const requestedDisplay = allMode ? displayCurrencyParam : ccyParam;
  const display: Currency = CURRENCIES.includes(requestedDisplay as Currency)
    ? (requestedDisplay as Currency)
    : "CAD";

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

  const balanceRows = accounts.map((a) => {
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
    if (!balance.ok) {
      return {
        ok: false as const,
        id: a.id,
        name: a.name,
        type: a.type as string,
        error: balance.error,
      };
    }
    return {
      ok: true as const,
      id: a.id,
      name: a.name,
      type: a.type as string,
      currency: balance.currency as Currency,
      balanceMinor: balance.balanceMinor,
    };
  });
  const unavailableRows = balanceRows.filter((row) => !row.ok);
  const rows = balanceRows.filter((row) => row.ok);

  let total: ReturnType<typeof netWorth> | null = null;
  let missingRate: string | null = null;
  if (unavailableRows.length === 0) {
    try {
      total = netWorth(rows, display, rates);
    } catch (e) {
      if (e instanceof MissingFxRateError) missingRate = e.message;
      else throw e;
    }
  }
  const balanceWarning =
    unavailableRows.length > 0
      ? `Balance unavailable for ${unavailableRows.map((row) => row.name).join(", ")}. Add a balance snapshot before net worth can be computed.`
      : null;

  const snapshotRows: SnapshotRow[] = accounts.flatMap((a) =>
    a.snapshots.map((s) => ({
      accountId: a.id,
      balanceMinor: s.balanceMinor,
      currency: s.currency as Currency,
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


  const [profile, dismissals, bills, dueCards] = await Promise.all([
    getOrCreateProfile(userId),
    prisma.alert.findMany({ where: { userId }, select: { ruleKey: true, entityRef: true } }),
    prisma.bill.findMany({ where: { userId }, include: { payments: true } }),
    prisma.creditCard.findMany({
      where: { userId, dueDay: { not: null } },
      select: { id: true, nickname: true, dueDay: true },
    }),
  ]);
  const in14 = new Date(todayDate.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
  const billEntries = bills.flatMap((b) =>
      billOccurrences(
        {
          id: b.id, name: b.name, category: b.category, currency: b.currency,
          autopay: b.autopay, variable: b.variable,
          cadence: b.cadence as unknown as Cadence,
          schedule: b.schedule as unknown as ScheduleEntry[],
        },
        today,
        in14,
      ).map((o) => ({
        ...o,
        paid: b.payments.some((p) => p.dueDate.toISOString().slice(0, 10) === o.date && p.paidAt),
      })),
    );
  const cardEntries = dueCards.flatMap((c) => {
    const [yearNow, monthNow] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
    const candidates = [0, 1].map((offset) => {
      const monthIndex = monthNow + offset;
      const month = monthIndex > 12 ? 1 : monthIndex;
      const year = monthIndex > 12 ? yearNow + 1 : yearNow;
      return `${year}-${String(month).padStart(2, "0")}-${String(c.dueDay).padStart(2, "0")}`;
    });
    const next = candidates.find((d) => d >= today && d <= in14);
    return next
      ? [
          {
            billId: `card-${c.id}`,
            billName: `💳 ${c.nickname} payment`,
            date: next,
            amountMinor: 0,
            currency: "CAD",
            autopay: false,
            variable: false,
            paid: false,
          },
        ]
      : [];
  });
  const upcoming = [...billEntries, ...cardEntries].sort((a, b) => (a.date < b.date ? -1 : 1));

  const snapshotForRules = await buildSnapshot(userId, today);
  const { alerts } = evaluateRules(profile, snapshotForRules, ALL_RULES);
  const { active } = applyDismissals(alerts, dismissals);
  const topAlerts = active.slice(0, 3);

  return (
    <main className="space-y-8 py-8">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Signed in as {user.email}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <nav aria-label="Net worth currency mode" className="flex gap-1 rounded border p-1 text-xs">
              <Link
                href={`/?ccy=ALL&display=${display}`}
                className={`rounded px-2 py-1 ${allMode ? "bg-foreground text-background" : ""}`}
              >
                All
              </Link>
              {CURRENCIES.map((c) => (
                <Link
                  key={c}
                  href={`/?ccy=${c}`}
                  className={`rounded px-2 py-1 ${!allMode && c === display ? "bg-foreground text-background" : ""}`}
                >
                  {c}
                </Link>
              ))}
            </nav>
            <form action={refreshFxRates}>
              <input type="hidden" name="ccy" value={allMode ? "ALL" : display} />
              {allMode ? <input type="hidden" name="display" value={display} /> : null}
              <button
                type="submit"
                className="rounded border px-2 py-1 text-xs"
                title="USD/CAD from Bank of Canada Valet (JMD stays manual)"
              >
                ↻ FX
              </button>
            </form>
          </div>
          {allMode ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Display as</span>
              <nav aria-label="All-currency display currency" className="flex gap-1 rounded border p-1">
                {CURRENCIES.map((c) => (
                  <Link
                    key={c}
                    href={`/?ccy=ALL&display=${c}`}
                    className={`rounded px-2 py-1 ${c === display ? "bg-foreground text-background" : ""}`}
                  >
                    {c}
                  </Link>
                ))}
              </nav>
            </div>
          ) : null}
          {fxOk ? <p className="text-xs text-green-700">{fxOk}</p> : null}
          {fxError ? <p className="text-xs text-red-600">{fxError}</p> : null}
        </div>
      </header>

      <section>
        <h2 className="text-sm text-muted-foreground">
          {allMode ? `Net worth (all currencies, ${display})` : `Net worth (${display})`}
        </h2>
        {total ? (
          <p className="text-3xl font-semibold tabular-nums">{formatMinorUnits(total.totalMinor, display)}</p>
        ) : (
          <p className="text-sm text-red-600">
            {balanceWarning ?? missingRate}
            {missingRate ? <> <Link href="/investments" className="underline">Add an FX rate via import</Link>.</> : null}
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
          {unavailableRows.map((a) => (
            <Link key={a.id} href={`/investments/${a.id}`} className="rounded border p-4 hover:bg-muted/50">
              <p className="text-sm font-medium">{a.name}</p>
              <p className="text-xs text-muted-foreground">{a.type}</p>
              <p className="mt-1 text-sm text-red-600">{a.error}</p>
            </Link>
          ))}
          <p className="text-sm text-muted-foreground">
            Account balances are shown in their native currencies until an FX rate is available.
          </p>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded border p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Alerts &amp; opportunities</p>
            <Link href="/money-finder" className="text-xs underline">
              all ({active.length})
            </Link>
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {topAlerts.map((a) => (
              <li key={`${a.ruleKey}:${a.entityRef}`} className="truncate">
                {a.severity === "critical" ? "🔴" : a.severity === "warning" ? "🟡" : "ℹ️"} {a.title}
              </li>
            ))}
            {topAlerts.length === 0 ? <li className="text-muted-foreground">All clear.</li> : null}
          </ul>
        </div>
        <div className="rounded border p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Next 14 days</p>
            <Link href="/bills" className="text-xs underline">bills</Link>
          </div>
          <ul className="mt-2 space-y-1 text-sm tabular-nums">
            {upcoming.map((o) => (
              <li key={`${o.billId}:${o.date}`} className="flex justify-between">
                <span>
                  {o.date.slice(5)} {o.billName}
                  {o.autopay ? <span className="ml-1 rounded bg-muted px-1 text-xs">auto</span> : null}
                  {o.paid ? " ✓" : ""}
                </span>
                <span>{o.amountMinor === 0 ? "-" : formatMinorUnits(o.amountMinor, o.currency as Currency)}</span>
              </li>
            ))}
            {upcoming.length === 0 ? <li className="text-muted-foreground">Nothing due.</li> : null}
          </ul>
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
