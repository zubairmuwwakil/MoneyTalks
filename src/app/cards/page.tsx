import Link from "next/link";
import { CardPicker } from "@/components/card-picker";
import type { CapUsage, CardDef, CardRewards } from "@/engine/cards/types";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export default async function CardsPage() {
  const userId = await requireUserId();
  const cards = await prisma.creditCard.findMany({
    where: { userId },
    include: { state: true },
    orderBy: { nickname: "asc" },
  });

  const defs: CardDef[] = cards.map((c) => ({
    id: c.id,
    nickname: c.nickname,
    network: c.network as CardDef["network"],
    annualFeeMinor: c.annualFeeMinor,
    rewards: c.rewards as unknown as CardRewards,
  }));
  const capUsage: CapUsage[] = cards.flatMap((c) =>
    ((c.state?.capsUsage as unknown as CapUsage[]) ?? []).map((u) => ({ ...u, cardId: c.id })),
  );

  return (
    <main className="space-y-6 py-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Which card?</h1>
        <div className="flex gap-2 text-sm">
          <Link href="/cards/cheatsheet" className="rounded border px-3 py-1 hover:bg-muted/50">
            Cheat sheet
          </Link>
          <Link href="/cards/analyzer" className="rounded border px-3 py-1 hover:bg-muted/50">
            Analyzer
          </Link>
          <Link href="/cards/manage" className="rounded border px-3 py-1 hover:bg-muted/50">
            Manage
          </Link>
        </div>
      </div>
      {defs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No cards yet - add them via{" "}
          <Link href="/investments/import" className="underline">
            Import
          </Link>
          .
        </p>
      ) : (
        <CardPicker cards={defs} capUsage={capUsage} today={new Date().toISOString().slice(0, 10)} />
      )}
    </main>
  );
}
