import Link from "next/link";
import { ArrowLeft, CreditCard, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  catalogueCard,
  catalogueCredits,
  catalogueCreditsRealizedMinor,
  effectiveAnnualFeeMinor,
  type RedeemedCredit,
} from "@/lib/cards/catalogueCard";
import type { CardDef } from "@/lib/cards/types";
import { formatMinorUnits, type Currency } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export default async function ManageCardsPage() {
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
    feeRebateMinor: c.feeRebateMinor,
    contractCardId: c.contractCardId,
  }));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="space-y-6 py-6 sm:py-8">
      <div>
        <Link
          href="/cards"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to Wallet</span>
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Manage cards</h1>
            <p className="text-sm text-muted-foreground">
              Review annual fees, realized credits, and net value across your portfolio.
            </p>
          </div>
          <Button asChild size="sm">
            <Link href="/cards/new" className="flex items-center gap-1.5">
              <Plus className="size-3.5" />
              <span>Add card</span>
            </Link>
          </Button>
        </div>
      </div>

      {cards.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="No cards in wallet"
          description="Add your first card to start evaluating rewards and net value."
          action={{
            label: "Add card",
            href: "/cards/new",
          }}
        />
      ) : null}

      <ul className="divide-y divide-border/60 rounded-xl border border-border/80 bg-card shadow-2xs overflow-hidden">
        {cards.map((c, i) => {
          const def = defs[i];
          const isDraft = catalogueCard(def.contractCardId)?.status === "draft";
          const redeemed = (c.state?.creditsRedeemed as unknown as RedeemedCredit[]) ?? [];
          const realizedMinor =
            (isDraft ? 0 : catalogueCreditsRealizedMinor(catalogueCredits(def.contractCardId), redeemed, today, c.feeMonthDay)) +
            (isDraft ? 0 : (c.state?.rewardsEstimateMinor ?? 0));
          const netMinor = realizedMinor - effectiveAnnualFeeMinor(def.annualFeeMinor, def.feeRebateMinor);
          return (
            <li key={c.id} className="transition-colors hover:bg-muted/40">
              <Link
                href={`/cards/${c.id}`}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground text-sm sm:text-base tracking-tight">
                      {c.nickname}
                    </span>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {c.network}
                    </Badge>
                    {isDraft ? <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-800 dark:text-amber-300">Unverified</Badge> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {c.issuer} - {c.network}
                  </p>
                </div>
                <div className="text-right">
                  {isDraft ? (
                    <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">Not included in net value</span>
                  ) : (
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      fee {formatMinorUnits(effectiveAnnualFeeMinor(def.annualFeeMinor, def.feeRebateMinor), c.currency as Currency)} - net {formatMinorUnits(netMinor, c.currency as Currency)}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
