import { accountBalance, latestSnapshot, type SnapshotInput, type TxInput } from "@/engine/balance";
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
        (s): SnapshotInput & { currency: Currency } => ({
          balanceMinor: s.balanceMinor,
          currency: s.currency as Currency,
          asOf: s.asOf.toISOString(),
        }),
      );
      const balance = accountBalance(
        a.transactions.map(
          (t): TxInput => ({ type: t.type, amountMinor: t.amountMinor, date: t.date.toISOString() }),
        ),
        snapshots,
      );
      return {
        id: a.id,
        type: a.type,
        name: a.name,
        institution: a.institution,
        country: a.country,
        currency: a.currency,
        balanceMinor: balance.balanceMinor,
        balanceCurrency: latestSnapshot(snapshots)?.currency ?? a.currency,
        balanceSource: balance.source,
        balanceAsOf: balance.asOf,
      };
    }),
  );
}
