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
  ownedCardIds?: string[];
  intermediariesCatalog?: BillIntermediary[];
}

export function scoreBillRoutes({
  payeeName,
  monthlyCad = 150.0,
  ownedCardIds = [],
  intermediariesCatalog = billIntermediaries,
}: ScoreBillRoutesParams): RouteRecommendation[] {
  const annualSpend = monthlyCad * 12.0;
  const routes: RouteRecommendation[] = [];

  for (const intermediary of intermediariesCatalog) {
    switch (intermediary.type) {
      case "creditIntermediary": {
        const hasScotiaMomentum = ownedCardIds.some(
          (c) => c.toLowerCase().includes("scotia") || c.toLowerCase().includes("momentum"),
        );
        const grossRate = hasScotiaMomentum ? 0.04 : 0.015;
        const cardName = hasScotiaMomentum
          ? "Scotiabank Momentum Visa Infinite"
          : "Standard Cash Back Card";
        const cardId = hasScotiaMomentum ? "scotiabank-momentum-vi" : "standard-card";
        const netSpread = grossRate - intermediary.feeRate;
        const mathText = `Earn ${(grossRate * 100).toFixed(1)}% - ${(intermediary.feeRate * 100).toFixed(2)}% fee = ${(netSpread * 100 >= 0 ? "+" : "")}${(netSpread * 100).toFixed(2)}% Net`;
        const instruction = hasScotiaMomentum
          ? "Set up pre-authorized recurring payment on Chexy using your Scotia Momentum VI."
          : "Caution: Using a lower-tier card may reduce net return due to the 1.75% processing fee.";

        routes.push({
          id: `${intermediary.id}_${cardId}`,
          intermediary,
          cardId,
          cardOfficialName: cardName,
          grossRewardRate: grossRate,
          feeRate: intermediary.feeRate,
          floatYieldRate: 0,
          netSpreadRate: netSpread,
          annualSpendCad: annualSpend,
          estimatedAnnualNetCad: Math.round(annualSpend * netSpread * 100) / 100,
          isOptimal: false,
          headline: hasScotiaMomentum ? "Maximum Points / Cash Back Route" : "Credit Card Processing Route",
          mathBreakdown: mathText,
          instruction,
        });
        break;
      }

      case "cardDirectBillPay": {
        const ownsTriangle = ownedCardIds.some((c) => c.toLowerCase().includes("triangle"));
        const directRate = intermediary.directRewardRate ?? 0.01;
        const mathText = `Direct Bill Pay (0% fee) = +${(directRate * 100).toFixed(1)}% Net CT Money`;

        routes.push({
          id: `${intermediary.id}_${ownsTriangle ? "triangle-we" : "triangle-opportunity"}`,
          intermediary,
          cardId: ownsTriangle ? "triangle-we" : "triangle-mastercard-opportunity",
          cardOfficialName: ownsTriangle ? "Triangle World Elite Mastercard" : "Canadian Tire Triangle Mastercard",
          grossRewardRate: directRate,
          feeRate: 0,
          floatYieldRate: 0,
          netSpreadRate: directRate,
          annualSpendCad: annualSpend,
          estimatedAnnualNetCad: Math.round(annualSpend * directRate * 100) / 100,
          isOptimal: false,
          headline: ownsTriangle ? "Zero-Fee Card Direct Bill Pay" : "No-Fee Municipal Payee Loophole",
          mathBreakdown: mathText,
          instruction: "Log into Canadian Tire Bank portal and add this bill payee to earn 1% CT Money with 0% fees.",
        });
        break;
      }

      case "fintechAccountRouting": {
        const floatRate = 0.0075; // Effective compound interest on float + perks
        const mathText = "0% Fee + High-Yield Float Interest (~2.5% APY on held funds)";

        routes.push({
          id: `${intermediary.id}_neo-money`,
          intermediary,
          cardId: null,
          cardOfficialName: "Neo Money Account",
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
          id: `${intermediary.id}_chequing`,
          intermediary,
          cardId: null,
          cardOfficialName: "Big-5 Chequing Account",
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
