import { accountBalanceWithCurrency, type CurrencySnapshotInput, type CurrencyTxInput } from "@/engine/balance";
import type { Currency } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const accounts = await prisma.financialAccount.findMany({
    where: { userId },
    include: { transactions: true, snapshots: true },
    orderBy: { name: "asc" },
  });

  return Response.json(
    accounts.map((a) => {
      const snapshots = a.snapshots.map(
        (s): CurrencySnapshotInput => ({
          balanceMinor: s.balanceMinor,
          currency: s.currency as Currency,
          asOf: s.asOf.toISOString(),
        }),
      );
      const balance = accountBalanceWithCurrency(
        a.transactions.map(
          (t): CurrencyTxInput => ({
            type: t.type,
            amountMinor: t.amountMinor,
            date: t.date.toISOString(),
            currency: t.currency,
          }),
        ),
        snapshots,
        a.currency,
      );
      return {
        id: a.id,
        type: a.type,
        name: a.name,
        institution: a.institution,
        country: a.country,
        currency: a.currency,
        balanceMinor: balance.ok ? balance.balanceMinor : null,
        balanceCurrency: balance.ok ? balance.currency : null,
        balanceSource: balance.ok ? balance.source : null,
        balanceAsOf: balance.ok ? balance.asOf : null,
        balanceError: balance.ok ? null : balance.error,
      };
    }),
  );
}
