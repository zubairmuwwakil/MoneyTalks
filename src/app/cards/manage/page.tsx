import Link from "next/link";
import { cardVerdict, isBestSomewhere, type RedeemedCredit } from "@/engine/cards/roi";
import { effectiveAnnualFeeMinor, type CardDef, type CardRewards } from "@/engine/cards/types";
import { formatMinorUnits } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

const VERDICT_STYLES: Record<string, string> = {
  KEEP: "bg-green-700 text-white",
  DOWNGRADE: "bg-amber-500 text-black",
  CANCEL_CANDIDATE: "bg-red-600 text-white",
};

export default async function ManageCardsPage() {
  const userId = await requireUserId();
  const cards = await prisma.creditCard.findMany({
    where: { userId },
    include: { state: true },
    orderBy: { nickname: "asc" },
  });
  const today = new Date().toISOString().slice(0, 10);
  const defs: CardDef[] = cards.map((c) => ({
    id: c.id,
    nickname: c.nickname,
    network: c.network as CardDef["network"],
    annualFeeMinor: c.annualFeeMinor,
    rewards: c.rewards as unknown as CardRewards,
  }));

  return (
    <main className="space-y-6 py-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Manage cards</h1>
        <Link href="/cards/new" className="rounded bg-foreground px-3 py-1 text-sm text-background">
          Add card
        </Link>
      </div>
      {cards.length === 0 ? <p className="text-sm text-muted-foreground">No cards yet. Add your first card to get started.</p> : null}
      <ul className="divide-y rounded border">
        {cards.map((c, i) => {
          const def = defs[i];
          const verdict = cardVerdict(
            def,
            (c.state?.creditsRedeemed as unknown as RedeemedCredit[]) ?? [],
            c.state?.rewardsEstimateMinor ?? 0,
            isBestSomewhere(def, defs, today),
            today,
          );
          return (
            <li key={c.id}>
              <Link
                href={`/cards/${c.id}`}
                className="flex flex-col gap-2 px-4 py-3 hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
              >
                <span>
                  <span className="font-medium">{c.nickname}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {c.issuer} - {c.network}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-3 text-sm tabular-nums">
                  <span>
                    fee {formatMinorUnits(effectiveAnnualFeeMinor(def), "CAD")} - net {formatMinorUnits(verdict.netMinor, "CAD")}
                  </span>
                  <span className={`rounded px-2 py-0.5 text-xs ${VERDICT_STYLES[verdict.verdict]}`}>
                    {verdict.verdict.replace("_", " ")}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
