import { billIntermediaries, type BillIntermediary } from "@/lib/contracts/billIntermediaries";

export type BillCategory =
  | "utilities_water"
  | "utilities_hydro"
  | "utilities_gas"
  | "property_tax"
  | "telecom"
  | "insurance"
  | "rent"
  | "tuition"
  | "household_expenses"
  | "other";

export interface RouteRecommendation {
  id: string;
  intermediary: BillIntermediary;
  walletCardId: string | null;
  cardId: string | null;
  cardOfficialName: string | null;
  grossRewardRate: number;
  feeRate: number;
  floatYieldRate: number;
  netSpreadRate: number;
  annualSpendCad: number;
  estimatedAnnualNetCad: number;
  isOptimal: boolean;
  headline: string;
  mathBreakdown: string;
  instruction: string;
}

/**
 * The routing engine only needs this small, already-resolved view of the
 * owner's wallet. Card reward math is derived from the card/owner-state
 * contracts on the server (see billRouteWallet.ts); the router never guesses
 * products from a nickname or manufactures a card the owner does not hold.
 */
export interface BillRouteWalletCard {
  walletCardId: string | null;
  contractCardId: string;
  programId: string;
  displayName: string;
  recurringRewardRate: number;
}

export function detectBillCategory(payeeName: string): BillCategory {
  const lower = payeeName.toLowerCase();
  if (lower.includes("water") || lower.includes("durham water") || lower.includes("region of durham")) {
    return "utilities_water";
  } else if (lower.includes("hydro") || lower.includes("electric") || lower.includes("alectra") || lower.includes("toronto hydro")) {
    return "utilities_hydro";
  } else if (lower.includes("gas") || lower.includes("enbridge")) {
    return "utilities_gas";
  } else if (lower.includes("tax") || lower.includes("property") || lower.includes("mun of") || lower.includes("city of")) {
    return "property_tax";
  } else if (lower.includes("bell") || lower.includes("rogers") || lower.includes("telus") || lower.includes("fido") || lower.includes("koodo")) {
    return "telecom";
  } else if (lower.includes("insurance") || lower.includes("desjardins") || lower.includes("intact") || lower.includes("aviva")) {
    return "insurance";
  } else if (lower.includes("rent") || lower.includes("prop") || lower.includes("realty")) {
    return "rent";
  } else if (lower.includes("univ") || lower.includes("college") || lower.includes("tuition")) {
    return "tuition";
  }
  return "household_expenses";
}

export interface ScoreBillRoutesParams {
  payeeName: string;
  accountNumber?: string;
  monthlyCad?: number;
  ownedCards?: BillRouteWalletCard[];
  intermediariesCatalog?: BillIntermediary[];
}

function intermediaryCategory(category: BillCategory): string {
  switch (category) {
    case "utilities_water":
    case "utilities_hydro":
    case "utilities_gas":
      return "utilities";
    case "household_expenses":
      return "household";
    default:
      return category;
  }
}

export function scoreBillRoutes({
  payeeName,
  monthlyCad = 150.0,
  ownedCards = [],
  intermediariesCatalog = billIntermediaries,
}: ScoreBillRoutesParams): RouteRecommendation[] {
  const detectedCategory = detectBillCategory(payeeName);
  const contractCategory = intermediaryCategory(detectedCategory);
  const annualSpend = monthlyCad * 12.0;
  const routes: RouteRecommendation[] = [];

  for (const intermediary of intermediariesCatalog) {
    if (!intermediary.supportedCategories.includes(contractCategory)) continue;

    switch (intermediary.type) {
      case "creditIntermediary": {
        const card = [...ownedCards].sort((a, b) => b.recurringRewardRate - a.recurringRewardRate)[0];
        if (!card) break;

        const grossRate = card.recurringRewardRate;
        const netSpread = grossRate - intermediary.feeRate;
        const mathText = `Earn ${(grossRate * 100).toFixed(1)}% - ${(intermediary.feeRate * 100).toFixed(2)}% fee = ${(netSpread * 100 >= 0 ? "+" : "")}${(netSpread * 100).toFixed(2)}% Net`;
        const instruction = netSpread > 0
          ? `Set up the recurring payment on ${intermediary.name} using ${card.displayName}.`
          : `${card.displayName}'s modeled rewards do not cover ${intermediary.name}'s processing fee.`;

        routes.push({
          id: `${intermediary.id}:${card.contractCardId}`,
          intermediary,
          walletCardId: card.walletCardId,
          cardId: card.contractCardId,
          cardOfficialName: card.displayName,
          grossRewardRate: grossRate,
          feeRate: intermediary.feeRate,
          floatYieldRate: 0,
          netSpreadRate: netSpread,
          annualSpendCad: annualSpend,
          estimatedAnnualNetCad: Math.round(annualSpend * netSpread * 100) / 100,
          isOptimal: false,
          headline: netSpread > 0 ? "Maximum Points / Cash Back Route" : "Credit Card Processing Route",
          mathBreakdown: mathText,
          instruction,
        });
        break;
      }

      case "cardDirectBillPay": {
        const directRate = intermediary.directRewardRate ?? 0.01;
        const rewardProgram = intermediary.directRewardProgramId ?? "rewards";
        const mathText = `Direct Bill Pay (${(intermediary.feeRate * 100).toFixed(1)}% fee) = +${((directRate - intermediary.feeRate) * 100).toFixed(1)}% Net ${rewardProgram}`;
        const eligibleCards = ownedCards.filter((card) =>
          !intermediary.restrictedCardPrograms?.length ||
          intermediary.restrictedCardPrograms.includes(card.contractCardId) ||
          intermediary.restrictedCardPrograms.includes(card.programId),
        );

        for (const card of eligibleCards) {
          routes.push({
            id: `${intermediary.id}:${card.contractCardId}`,
            intermediary,
            walletCardId: card.walletCardId,
            cardId: card.contractCardId,
            cardOfficialName: card.displayName,
            grossRewardRate: directRate,
            feeRate: intermediary.feeRate,
            floatYieldRate: 0,
            netSpreadRate: directRate - intermediary.feeRate,
            annualSpendCad: annualSpend,
            estimatedAnnualNetCad: Math.round(annualSpend * (directRate - intermediary.feeRate) * 100) / 100,
            isOptimal: false,
            headline: "Zero-Fee Card Direct Bill Pay",
            mathBreakdown: mathText,
            instruction: `Use ${card.displayName} in ${intermediary.name} to pay this payee.`,
          });
        }
        break;
      }

      case "fintechAccountRouting": {
        const holdingApy = intermediary.holdingApy ?? 0;
        const floatRate = holdingApy * (intermediary.settlementDays / 365);
        const mathText = `0% Fee + ${(holdingApy * 100).toFixed(1)}% APY during the ${intermediary.settlementDays}-day settlement float`;

        routes.push({
          id: intermediary.id,
          intermediary,
          walletCardId: null,
          cardId: null,
          cardOfficialName: null,
          grossRewardRate: 0,
          feeRate: 0,
          floatYieldRate: floatRate,
          netSpreadRate: floatRate,
          annualSpendCad: annualSpend,
          estimatedAnnualNetCad: Math.round(annualSpend * floatRate * 100) / 100,
          isOptimal: false,
          headline: "Smart Digital Cash / Yield Route",
          mathBreakdown: mathText,
          instruction: "Pay directly from Neo Money account to earn compound interest on your bill buffer before payment.",
        });
        break;
      }

      case "standardEft": {
        routes.push({
          id: intermediary.id,
          intermediary,
          walletCardId: null,
          cardId: null,
          cardOfficialName: null,
          grossRewardRate: 0,
          feeRate: 0,
          floatYieldRate: 0,
          netSpreadRate: 0,
          annualSpendCad: annualSpend,
          estimatedAnnualNetCad: 0,
          isOptimal: false,
          headline: "Standard Chequing Bill Pay",
          mathBreakdown: "0% Fees, $0.00 Rewards Baseline",
          instruction: "Standard bank bill payment with no reward accrual.",
        });
        break;
      }
    }
  }

  // Sort descending by net dollar gain
  routes.sort((a, b) => b.estimatedAnnualNetCad - a.estimatedAnnualNetCad);

  // Mark the top one as optimal
  if (routes.length > 0) {
    routes[0].isOptimal = true;
  }

  return routes;
}
