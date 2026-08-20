import { effectiveAnnualFeeMinor, catalogueCredits } from "@/lib/cards/catalogueCard";
import { currentFeeCycle, feeCycleDaysRemaining, type FeeScheduleCard } from "@/lib/cards/feeSchedule";
import { buildCheatSheetRecommendations } from "@/lib/cards/cardPresentation";
import type { CardDef } from "@/lib/cards/types";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { WalletClient } from "@/components/cards/wallet-client";
import type { CardTileData } from "@/components/cards/card-tile";
import type { WalletSummaryStats } from "@/components/cards/wallet-summary-bar";

export default async function CardsPage() {
  const userId = await requireUserId();
  const cards = await prisma.creditCard.findMany({
    where: { userId },
    orderBy: { nickname: "asc" },
    include: { coverageReports: { orderBy: { month: "desc" }, take: 1 } },
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

  // Compute portfolio stats
  let totalAnnualFeeMinor = 0;
  let totalGrossFeeMinor = 0;
  let totalCreditsCad = 0;
  let missingRenewalDateCount = 0;
  let decisionWindowCount = 0;

  const networkCounts = { amex: 0, visa: 0, mastercard: 0, other: 0 };
  const upcomingCycleNotes: Array<{ days: number; note: string }> = [];

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const def = defs[i];
    const cycle = cycles[i];

    const effFee = effectiveAnnualFeeMinor(def.annualFeeMinor, def.feeRebateMinor);
    totalAnnualFeeMinor += effFee;
    totalGrossFeeMinor += def.annualFeeMinor;

    const credits = catalogueCredits(c.contractCardId);
    totalCreditsCad += credits.reduce((sum, cr) => sum + cr.valueCad, 0);

    const net = c.network.toUpperCase();
    if (net === "AMEX") networkCounts.amex++;
    else if (net === "VISA") networkCounts.visa++;
    else if (net === "MASTERCARD") networkCounts.mastercard++;
    else networkCounts.other++;

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

  const stats: WalletSummaryStats = {
    totalAnnualFeeMinor,
    totalGrossFeeMinor,
    totalCreditsCad,
    cardCount: cards.length,
    networkCounts,
    missingRenewalDateCount,
    closestRenewalNote: closest?.note ?? null,
    closestRenewalDays: closest?.days ?? null,
    decisionWindowCount,
  };

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
        categories={categories}
        todayIso={today.toISOString()}
      />
    </main>
  );
}
