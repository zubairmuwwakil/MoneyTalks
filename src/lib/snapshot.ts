import { accountBalance } from "@/engine/balance";
import type { FxRateInput } from "@/engine/fx";
import type { Currency } from "@/engine/money";
import type { AccountView, FinancialSnapshot } from "@/engine/rules/types";
import { prisma } from "@/lib/prisma";

export async function buildSnapshot(userId: string, today: string): Promise<FinancialSnapshot> {
  const [accounts, fxRates] = await Promise.all([
    prisma.financialAccount.findMany({
      where: { userId },
      include: { holdings: true, transactions: true, snapshots: true },
      orderBy: { name: "asc" },
    }),
    prisma.fxRate.findMany({ where: { userId } }),
  ]);

  const accountViews: AccountView[] = accounts.map((a) => {
    const txs = a.transactions.map((t) => ({
      id: t.id,
      type: t.type,
      amountMinor: t.amountMinor,
      currency: t.currency,
      date: t.date.toISOString(),
    }));
    const snaps = a.snapshots.map((s) => ({ balanceMinor: s.balanceMinor, asOf: s.asOf.toISOString() }));
    const balance = accountBalance(
      txs.map((t) => ({ type: t.type, amountMinor: t.amountMinor, date: t.date })),
      snaps,
    );
    return {
      id: a.id,
      type: a.type,
      name: a.name,
      institution: a.institution,
      country: a.country,
      currency: a.currency as Currency,
      isUSSitus: a.isUSSitus,
      balanceMinor: balance.balanceMinor,
      balanceAsOf: balance.asOf,
      holdings: a.holdings.map((h) => ({
        id: h.id,
        symbol: h.symbol,
        name: h.name,
        domicileCountry: h.domicileCountry,
        quantity: Number(h.quantity),
        bookCostMinor: h.bookCostMinor,
        lastPriceMinor: h.lastPriceMinor,
        priceAsOf: h.priceAsOf.toISOString(),
      })),
      transactions: txs,
      snapshots: snaps,
    };
  });

  const rates: FxRateInput[] = fxRates.map((r) => ({
    base: r.base as Currency,
    quote: r.quote as Currency,
    rate: Number(r.rate),
    asOf: r.asOf.toISOString(),
  }));

  return { today, accounts: accountViews, fxRates: rates };
}
