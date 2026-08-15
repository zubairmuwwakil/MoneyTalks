import { accountBalance, type SnapshotInput, type TxInput } from "@/engine/balance";
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
      const balance = accountBalance(
        a.transactions.map(
          (t): TxInput => ({ type: t.type, amountMinor: t.amountMinor, date: t.date.toISOString() }),
        ),
        a.snapshots.map(
          (s): SnapshotInput => ({ balanceMinor: s.balanceMinor, asOf: s.asOf.toISOString() }),
        ),
      );
      return {
        id: a.id,
        type: a.type,
        name: a.name,
        institution: a.institution,
        country: a.country,
        currency: a.currency,
        balanceMinor: balance.balanceMinor,
        balanceSource: balance.source,
        balanceAsOf: balance.asOf,
      };
    }),
  );
}
