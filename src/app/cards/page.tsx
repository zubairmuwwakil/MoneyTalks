import { effectiveAnnualFeeMinor, catalogueCredits, type RedeemedCredit } from "@/lib/cards/catalogueCard";
import { toReporting } from "@/engine/cards-twin/reportingCurrency";
import { currentFeeCycle, feeCycleDaysRemaining, type FeeScheduleCard } from "@/lib/cards/feeSchedule";
import { buildCheatSheetRecommendations } from "@/lib/cards/cardPresentation";
import type { CardDef } from "@/lib/cards/types";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { WalletClient } from "@/components/cards/wallet-client";
import type { CardTileData } from "@/components/cards/card-tile";
import type { WalletOperationalStats } from "@/components/cards/wallet-client";
import { buildWalletImpact } from "@/lib/domain/cards/walletImpact";

export default async function CardsPage() {
  const userId = await requireUserId();
  const cards = await prisma.creditCard.findMany({
    where: { userId },
    orderBy: { nickname: "asc" },
    include: {
      state: true,
      coverageReports: { orderBy: { month: "desc" }, take: 1 },
    },
  });

  const defs: FeeScheduleCard[] = cards.map((c) => ({
    id: c.id,
    nickname: c.nickname,
    network: c.network as CardDef["network"],
    annualFeeMinor: c.annualFeeMinor,
    feeRebateMinor: c.feeRebateMinor,
    contractCardId: c.contractCardId,
    feeMonthDay: c.feeMonthDay,
    feeCancelGraceDays: c.feeCancelGraceDays,
  }));

  const today = new Date();
  const cycles = defs.map((def) => currentFeeCycle(def, today));

  let missingRenewalDateCount = 0;
  let decisionWindowCount = 0;

  const upcomingCycleNotes: Array<{ days: number; note: string }> = [];

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const def = defs[i];
    const cycle = cycles[i];

    const effFee = effectiveAnnualFeeMinor(def.annualFeeMinor, def.feeRebateMinor);
    if (effFee > 0 && !c.feeMonthDay) {
      missingRenewalDateCount++;
    }

    if (cycle) {
      const days = feeCycleDaysRemaining(cycle, today);
      if (cycle.phase === "DECISION_WINDOW") {
        decisionWindowCount++;
        upcomingCycleNotes.push({
          days,
          note: `${c.nickname} decision window (${days}d left to cancel)`,
        });
      } else {
        upcomingCycleNotes.push({
          days,
          note: `${c.nickname} fee renews in ${days}d`,
        });
      }
    }
  }

  upcomingCycleNotes.sort((a, b) => a.days - b.days);
  const closest = upcomingCycleNotes[0] ?? null;

  const stats: WalletOperationalStats = {
    missingRenewalDateCount,
    closestRenewalNote: closest?.note ?? null,
    closestRenewalDays: closest?.days ?? null,
    decisionWindowCount,
  };

  const impact = buildWalletImpact(
    cards.map((card) => ({
      id: card.id,
      nickname: card.nickname,
      issuer: card.issuer,
      annualFeeMinor: card.annualFeeMinor,
      feeRebateMinor: card.feeRebateMinor,
      rewardsEstimateMinor: card.state?.rewardsEstimateMinor ?? 0,
      credits: catalogueCredits(card.contractCardId).map((c) => ({
        creditId: c.creditId,
        valueCad: toReporting(c.value),
        period: c.period,
      })),
      redeemed: (card.state?.creditsRedeemed as unknown as RedeemedCredit[]) ?? [],
    })),
    today.getUTCFullYear(),
  );

  const cardTiles: CardTileData[] = cards.map((c) => {
    const report = c.coverageReports[0];
    const coveragePercentage =
      report && report.eligibleLines > 0
        ? (report.matchedLines / report.eligibleLines) * 100
        : null;

    return {
      id: c.id,
      nickname: c.nickname,
      issuer: c.issuer,
      network: c.network,
      lastFour: c.lastFour,
      currency: c.currency,
      annualFeeMinor: c.annualFeeMinor,
      feeRebateMinor: c.feeRebateMinor,
      contractCardId: c.contractCardId,
      feeMonthDay: c.feeMonthDay,
      feeCancelGraceDays: c.feeCancelGraceDays,
      coveragePercentage,
    };
  });

  const categories = buildCheatSheetRecommendations(cards);

  return (
    <main className="space-y-6 py-6 sm:py-8">
      <WalletClient
        cards={cardTiles}
        cycles={cycles}
        stats={stats}
        impact={impact}
        categories={categories}
        todayIso={today.toISOString()}
      />
    </main>
  );
}
