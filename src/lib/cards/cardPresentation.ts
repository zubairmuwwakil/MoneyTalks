import { cardCatalogue, benefitsCatalogue, type CardProduct } from "@/lib/contracts/cardCatalogue";

export interface EarnHighlight {
  label: string;
  rate: string;
  isTop?: boolean;
}

export interface InsuranceHighlight {
  label: string;
  kind: string;
}

export interface CardBranding {
  accentColor: string;
  borderClass: string;
  bgGradient: string;
  badgeClass: string;
  chipClass: string;
}

const BENEFIT_LABELS: Record<string, string> = {
  purchaseProtection: "Purchase Protection",
  extendedWarranty: "Extended Warranty",
  mobileDeviceInsurance: "Mobile Device Ins.",
  flightDelay: "Flight Delay",
  baggageDelay: "Baggage Delay",
  baggageLoss: "Lost Luggage",
  carRentalCollision: "Rental Car CDW",
  travelMedical: "Emergency Medical",
  tripCancellation: "Trip Cancellation",
  tripInterruption: "Trip Interruption",
  hotelBurglary: "Hotel Burglary",
};

export function getCardEarnHighlights(card: CardProduct | null): EarnHighlight[] {
  if (!card) return [];

  const highlights: EarnHighlight[] = [];

  // Check for 0% FX rule first
  const currentFx = card.fxRules.find((f) => f.status === "current");
  if (currentFx && currentFx.rate === 0) {
    highlights.push({
      label: "Foreign FX",
      rate: "0% FX Fee",
      isTop: true,
    });
  }

  // Sort earn rules by pointsPerUnit or cashback rate desc
  const currentEarnRules = card.earnRules
    .filter((r) => r.status === "current")
    .map((r) => {
      let multiplier = 1;
      if (r.earn.type === "points") multiplier = r.earn.pointsPerUnit;
      else if (r.earn.type === "cashback") multiplier = r.earn.rate * 100;
      else if (r.earn.type === "centsPerLitre") multiplier = (r.earn.otherCentsPerLitre ?? 3) / 100;
      return { rule: r, multiplier };
    })
    .sort((a, b) => b.multiplier - a.multiplier);

  for (const { rule } of currentEarnRules) {
    const cats = rule.predicate.categories ?? [];
    let rateStr = "";
    if (rule.earn.type === "points") {
      rateStr = `${rule.earn.pointsPerUnit}×`;
    } else if (rule.earn.type === "cashback") {
      rateStr = `${rule.earn.rate * 100}%`;
    } else if (rule.earn.type === "centsPerLitre") {
      rateStr = `${rule.earn.otherCentsPerLitre ?? 3}¢/L`;
    }

    if (cats.length > 0) {
      const catNames = cats
        .map((c) => {
          if (c === "dining" || c === "foodDelivery") return "Dining";
          if (c === "grocery") return "Groceries";
          if (c === "gasStation" || c === "transit") return "Gas & Transit";
          if (c === "streaming" || c === "digitalMedia") return "Streaming";
          if (c === "travel" || c === "lodging") return "Travel";
          if (c === "utilities" || c === "recurringBills") return "Bills";
          if (c === "homeImprovement") return "Home Imp.";
          return c;
        })
        .filter((val, idx, arr) => arr.indexOf(val) === idx)
        .slice(0, 2)
        .join(" & ");

      highlights.push({
        label: catNames,
        rate: rateStr,
        isTop: highlights.length === 0,
      });
    } else if (!highlights.some((h) => h.label === "All spend")) {
      highlights.push({
        label: "All spend",
        rate: rateStr,
        isTop: false,
      });
    }

    if (highlights.length >= 3) break;
  }

  return highlights;
}

export function getCardInsuranceHighlights(contractCardId: string | null | undefined): InsuranceHighlight[] {
  if (!contractCardId) return [];
  const cardBenefits = benefitsCatalogue.cards.find((c) => c.cardId === contractCardId);
  if (!cardBenefits) return [];

  const priorityKinds = [
    "mobileDeviceInsurance",
    "carRentalCollision",
    "travelMedical",
    "flightDelay",
    "purchaseProtection",
    "tripCancellation",
  ];

  const found: InsuranceHighlight[] = [];
  for (const kind of priorityKinds) {
    const b = cardBenefits.benefits.find((item) => item.kind === kind);
    if (b) {
      let label = BENEFIT_LABELS[kind] || kind;
      if (kind === "purchaseProtection" && b.coverage.windowDays) {
        label = `${b.coverage.windowDays}d Purchase Prot.`;
      } else if (kind === "flightDelay" && b.coverage.delayHours) {
        label = `${b.coverage.delayHours}h Flight Delay`;
      } else if (kind === "travelMedical" && b.coverage.maxTripLengthDays) {
        label = `${b.coverage.maxTripLengthDays}d Medical`;
      }
      found.push({ label, kind });
      if (found.length >= 3) break;
    }
  }

  return found;
}

export function getCardBranding(
  network: string,
  issuer: string,
  nickname: string,
  contractCardId?: string | null,
): CardBranding {
  const norm = `${nickname} ${issuer} ${contractCardId ?? ""}`.toLowerCase();

  if (norm.includes("cobalt")) {
    return {
      accentColor: "#1e3a8a",
      borderClass: "border-blue-500/40 dark:border-blue-400/30",
      bgGradient: "from-blue-600/10 via-indigo-500/5 to-transparent",
      badgeClass: "bg-blue-600/15 text-blue-800 dark:text-blue-300 border-blue-500/30",
      chipClass: "bg-blue-600 text-white",
    };
  }

  if (norm.includes("platinum")) {
    return {
      accentColor: "#64748b",
      borderClass: "border-slate-400/40 dark:border-slate-400/30",
      bgGradient: "from-slate-400/15 via-zinc-400/5 to-transparent",
      badgeClass: "bg-slate-500/15 text-slate-800 dark:text-slate-200 border-slate-400/30",
      chipClass: "bg-slate-700 text-white",
    };
  }

  if (norm.includes("scotia") || norm.includes("momentum")) {
    return {
      accentColor: "#dc2626",
      borderClass: "border-rose-500/40 dark:border-rose-500/30",
      bgGradient: "from-rose-500/10 via-red-500/5 to-transparent",
      badgeClass: "bg-rose-500/15 text-rose-800 dark:text-rose-300 border-rose-500/30",
      chipClass: "bg-rose-600 text-white",
    };
  }

  if (norm.includes("rogers")) {
    return {
      accentColor: "#ef4444",
      borderClass: "border-red-500/40 dark:border-red-500/30",
      bgGradient: "from-red-600/10 via-rose-500/5 to-transparent",
      badgeClass: "bg-red-500/15 text-red-800 dark:text-red-300 border-red-500/30",
      chipClass: "bg-red-600 text-white",
    };
  }

  if (norm.includes("tangerine")) {
    return {
      accentColor: "#f97316",
      borderClass: "border-orange-500/40 dark:border-orange-500/30",
      bgGradient: "from-orange-500/10 via-amber-500/5 to-transparent",
      badgeClass: "bg-orange-500/15 text-orange-800 dark:text-orange-300 border-orange-500/30",
      chipClass: "bg-orange-500 text-white",
    };
  }

  if (norm.includes("triangle") || norm.includes("canadian tire")) {
    return {
      accentColor: "#15803d",
      borderClass: "border-emerald-500/40 dark:border-emerald-500/30",
      bgGradient: "from-emerald-600/10 via-teal-500/5 to-transparent",
      badgeClass: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
      chipClass: "bg-emerald-700 text-white",
    };
  }

  if (norm.includes("crypto.com") || norm.includes("indigo") || norm.includes("ruby")) {
    return {
      accentColor: "#4f46e5",
      borderClass: "border-indigo-500/40 dark:border-indigo-500/30",
      bgGradient: "from-indigo-600/15 via-purple-500/5 to-transparent",
      badgeClass: "bg-indigo-500/15 text-indigo-800 dark:text-indigo-300 border-indigo-500/30",
      chipClass: "bg-indigo-600 text-white",
    };
  }

  if (norm.includes("wealthsimple")) {
    return {
      accentColor: "#059669",
      borderClass: "border-emerald-500/40 dark:border-emerald-500/30",
      bgGradient: "from-emerald-500/10 via-zinc-500/5 to-transparent",
      badgeClass: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
      chipClass: "bg-emerald-600 text-white",
    };
  }

  if (norm.includes("marriott") || norm.includes("bonvoy")) {
    return {
      accentColor: "#b91c1c",
      borderClass: "border-amber-600/40 dark:border-amber-500/30",
      bgGradient: "from-amber-600/10 via-red-500/5 to-transparent",
      badgeClass: "bg-amber-600/15 text-amber-900 dark:text-amber-300 border-amber-500/30",
      chipClass: "bg-amber-700 text-white",
    };
  }

  if (norm.includes("mbna")) {
    return {
      accentColor: "#0284c7",
      borderClass: "border-sky-500/40 dark:border-sky-500/30",
      bgGradient: "from-sky-600/10 via-blue-500/5 to-transparent",
      badgeClass: "bg-sky-500/15 text-sky-800 dark:text-sky-300 border-sky-500/30",
      chipClass: "bg-sky-600 text-white",
    };
  }

  // Default network based fallback
  const net = network.toUpperCase();
  if (net === "AMEX") {
    return {
      accentColor: "#0284c7",
      borderClass: "border-sky-500/30 dark:border-sky-400/20",
      bgGradient: "from-sky-500/5 to-transparent",
      badgeClass: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20",
      chipClass: "bg-sky-600 text-white",
    };
  }

  if (net === "MASTERCARD") {
    return {
      accentColor: "#ea580c",
      borderClass: "border-orange-500/30 dark:border-orange-400/20",
      bgGradient: "from-orange-500/5 to-transparent",
      badgeClass: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20",
      chipClass: "bg-orange-600 text-white",
    };
  }

  return {
    accentColor: "#2563eb",
    borderClass: "border-border",
    bgGradient: "from-muted/20 to-transparent",
    badgeClass: "bg-secondary text-secondary-foreground border-border",
    chipClass: "bg-foreground text-background",
  };
}

export interface CheatSheetCategoryItem {
  id: string;
  name: string;
  icon: string;
  bestCardId: string | null;
  bestCardName: string;
  bestCardRate: string;
  runnerUpCardName: string | null;
  runnerUpCardRate: string | null;
  why: string;
  cautionNote?: string;
}

export function buildCheatSheetRecommendations(
  cards: Array<{
    id: string;
    nickname: string;
    network: string;
    contractCardId?: string | null;
  }>,
): CheatSheetCategoryItem[] {
  // Built from catalogue earn rules and network restrictions
  const categories: Array<{
    id: string;
    name: string;
    icon: string;
    predicateCheck: (product: CardProduct | null, cardNetwork: string) => { rate: number; label: string } | null;
    cautionNote?: string;
  }> = [
    {
      id: "groceries",
      name: "Groceries & Supermarkets",
      icon: "🛒",
      predicateCheck: (prod) => {
        if (!prod) return { rate: 1, label: "1% Base" };
        const groceryRule = prod.earnRules.find(
          (r) => r.status === "current" && r.predicate.categories?.includes("grocery"),
        );
        if (groceryRule) {
          if (groceryRule.earn.type === "points") return { rate: groceryRule.earn.pointsPerUnit * 1.5, label: `${groceryRule.earn.pointsPerUnit}× MR (~${groceryRule.earn.pointsPerUnit * 1.5}%)` };
          if (groceryRule.earn.type === "cashback") return { rate: groceryRule.earn.rate * 100, label: `${groceryRule.earn.rate * 100}%` };
        }
        return { rate: 1, label: "1% Base" };
      },
    },
    {
      id: "dining",
      name: "Dining & Food Delivery",
      icon: "🍽️",
      predicateCheck: (prod) => {
        if (!prod) return { rate: 1, label: "1% Base" };
        const diningRule = prod.earnRules.find(
          (r) => r.status === "current" && (r.predicate.categories?.includes("dining") || r.predicate.categories?.includes("foodDelivery")),
        );
        if (diningRule) {
          if (diningRule.earn.type === "points") return { rate: diningRule.earn.pointsPerUnit * 1.5, label: `${diningRule.earn.pointsPerUnit}× MR (~${diningRule.earn.pointsPerUnit * 1.5}%)` };
          if (diningRule.earn.type === "cashback") return { rate: diningRule.earn.rate * 100, label: `${diningRule.earn.rate * 100}%` };
        }
        return { rate: 1, label: "1% Base" };
      },
    },
    {
      id: "gas",
      name: "Gas & Fuel",
      icon: "⛽",
      predicateCheck: (prod) => {
        if (!prod) return { rate: 1, label: "1% Base" };
        const gasRule = prod.earnRules.find(
          (r) => r.status === "current" && r.predicate.categories?.includes("gasStation"),
        );
        if (gasRule) {
          if (gasRule.earn.type === "points") return { rate: gasRule.earn.pointsPerUnit * 1.2, label: `${gasRule.earn.pointsPerUnit}× (~${gasRule.earn.pointsPerUnit * 1.2}%)` };
          if (gasRule.earn.type === "cashback") return { rate: gasRule.earn.rate * 100, label: `${gasRule.earn.rate * 100}%` };
        }
        return { rate: 1, label: "1% Base" };
      },
    },
    {
      id: "bills",
      name: "Recurring Bills & Utilities",
      icon: "⚡",
      predicateCheck: (prod) => {
        if (!prod) return { rate: 1, label: "1% Base" };
        const billRule = prod.earnRules.find(
          (r) => r.status === "current" && (r.predicate.recurringViaNetworkIndicator || r.predicate.categories?.includes("utilities")),
        );
        if (billRule) {
          if (billRule.earn.type === "points") return { rate: billRule.earn.pointsPerUnit * 1.2, label: `${billRule.earn.pointsPerUnit}×` };
          if (billRule.earn.type === "cashback") return { rate: billRule.earn.rate * 100, label: `${billRule.earn.rate * 100}%` };
        }
        return { rate: 1, label: "1% Base" };
      },
    },
    {
      id: "costco",
      name: "Costco & Wholesale Clubs (In-Store)",
      icon: "🏬",
      cautionNote: "Costco Canada accepts Mastercard only in-store",
      predicateCheck: (prod, network) => {
        if (network.toUpperCase() !== "MASTERCARD") return null; // Ineligible at till
        if (!prod) return { rate: 1, label: "1% Base" };
        if (prod.cardId.includes("rogers")) return { rate: 2.0, label: "2.0% (3% on Shaw/Rogers)" };
        if (prod.cardId.includes("mbna")) return { rate: 1.0, label: "1× Base" };
        return { rate: 1, label: "1% Base" };
      },
    },
    {
      id: "travel",
      name: "Travel & Flights Booking",
      icon: "✈️",
      predicateCheck: (prod) => {
        if (!prod) return { rate: 1, label: "1% Base" };
        const travelRule = prod.earnRules.find(
          (r) => r.status === "current" && r.predicate.categories?.includes("travel"),
        );
        if (travelRule) {
          if (travelRule.earn.type === "points") return { rate: travelRule.earn.pointsPerUnit * 1.5, label: `${travelRule.earn.pointsPerUnit}× MR (~${travelRule.earn.pointsPerUnit * 1.5}%)` };
          if (travelRule.earn.type === "cashback") return { rate: travelRule.earn.rate * 100, label: `${travelRule.earn.rate * 100}%` };
        }
        return { rate: 1, label: "1% Base" };
      },
    },
    {
      id: "foreign",
      name: "Foreign Currency (FX / USD / Abroad)",
      icon: "🌐",
      predicateCheck: (prod) => {
        if (!prod) return { rate: 0, label: "2.5% FX Fee" };
        const currentFx = prod.fxRules.find((f) => f.status === "current");
        const fxRate = currentFx?.rate ?? 0.025;
        if (fxRate === 0) return { rate: 1.0, label: "0% FX Fee + 1% Back" };
        if (prod.cardId.includes("rogers")) return { rate: 0.5, label: "3% USD Cashback (Net +0.5%)" };
        return { rate: -1.5, label: `2.5% FX Fee` };
      },
    },
    {
      id: "catchall",
      name: "Everything Else (Catch-All Spend)",
      icon: "📦",
      predicateCheck: (prod) => {
        if (!prod) return { rate: 1, label: "1%" };
        if (prod.cardId.includes("rogers")) return { rate: 2.0, label: "2.0% Flat Rate" };
        if (prod.cardId.includes("crypto")) return { rate: 2.0, label: "2.0% CRO" };
        if (prod.cardId.includes("cobalt")) return { rate: 1.5, label: "1× MR (~1.5%)" };
        return { rate: 1.0, label: "1.0% Base" };
      },
    },
  ];

  return categories.map((cat) => {
    const scoredCards = cards
      .map((c) => {
        const prod = cardCatalogue.cards.find((p) => p.cardId === c.contractCardId) ?? null;
        const result = cat.predicateCheck(prod, c.network);
        if (!result) return null;
        return {
          id: c.id,
          name: c.nickname,
          rateScore: result.rate,
          rateLabel: result.label,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => b.rateScore - a.rateScore);

    const best = scoredCards[0] ?? null;
    const runnerUp = scoredCards[1] ?? null;

    let why = best ? `Highest effective return for ${cat.name.toLowerCase()}` : "No eligible card in wallet";
    if (cat.id === "costco" && best) {
      why = "Mastercard only in-store at Costco Canada";
    } else if (cat.id === "foreign" && best) {
      why = "Saves the standard 2.5% foreign transaction fee";
    }

    return {
      id: cat.id,
      name: cat.name,
      icon: cat.icon,
      bestCardId: best?.id ?? null,
      bestCardName: best?.name ?? "None",
      bestCardRate: best?.rateLabel ?? "—",
      runnerUpCardName: runnerUp?.name ?? null,
      runnerUpCardRate: runnerUp?.rateLabel ?? null,
      why,
      cautionNote: cat.cautionNote,
    };
  });
}
