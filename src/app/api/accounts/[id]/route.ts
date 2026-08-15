import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const account = await prisma.financialAccount.findFirst({
    where: { id, userId },
    include: { holdings: true, transactions: { orderBy: { date: "desc" } }, snapshots: { orderBy: { asOf: "desc" } } },
  });
  if (!account) return Response.json({ error: "not found" }, { status: 404 });

  return Response.json({
    ...account,
    holdings: account.holdings.map((h) => ({ ...h, quantity: Number(h.quantity) })),
  });
}
