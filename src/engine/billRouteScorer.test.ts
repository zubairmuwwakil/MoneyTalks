import { describe, expect, it } from "vitest";
import {
  detectBillCategory,
  scoreBillRoutes,
  type BillRouteWalletCard,
} from "./billRouteScorer";

function walletCard(
  contractCardId: string,
  displayName: string,
  recurringRewardRate: number,
  programId = "cashback",
): BillRouteWalletCard {
  return {
    walletCardId: `wallet-${contractCardId}`,
    contractCardId,
    programId,
    displayName,
    recurringRewardRate,
  };
}

describe("billRouteScorer (TypeScript Twin)", () => {
  it("auto-detects Durham Water as utilities_water", () => {
    expect(detectBillCategory("DURHAM WATER, REG MUN OF")).toBe("utilities_water");
    expect(detectBillCategory("Region of Durham Water")).toBe("utilities_water");
  });

  it("auto-detects Toronto Hydro as utilities_hydro", () => {
    expect(detectBillCategory("TORONTO HYDRO-ELECTRIC SYSTEM")).toBe("utilities_hydro");
  });

  it("recommends Chexy with Scotia Momentum for highest net spread", () => {
    const routes = scoreBillRoutes({
      payeeName: "DURHAM WATER, REG MUN OF",
      monthlyCad: 150,
      ownedCards: [
        walletCard("scotia-momentum-vi-plus", "My Momentum", 0.04),
        walletCard("triangle-we", "Household Triangle", 0.0095),
      ],
    });

    expect(routes.length).toBeGreaterThan(0);
    const top = routes[0];
    expect(top.intermediary.id).toBe("chexy");
    expect(top.isOptimal).toBe(true);
    expect(top.netSpreadRate).toBeCloseTo(0.0225, 4);
    expect(top.estimatedAnnualNetCad).toBe(40.5);
    expect(top.cardOfficialName).toBe("My Momentum");
    expect(top.walletCardId).toBe("wallet-scotia-momentum-vi-plus");
  });

  it("recommends Triangle Bill Pay when Triangle is owned and no 4% card exists", () => {
    const routes = scoreBillRoutes({
      payeeName: "DURHAM WATER, REG MUN OF",
      monthlyCad: 200,
      ownedCards: [walletCard("triangle-we", "My Triangle", 0.0095)],
    });

    expect(routes.length).toBeGreaterThan(0);
    const top = routes[0];
    expect(top.intermediary.id).toBe("triangle-bill-pay");
    expect(top.isOptimal).toBe(true);
    expect(top.netSpreadRate).toBeCloseTo(0.01, 4);
    expect(top.estimatedAnnualNetCad).toBe(24);
  });

  it("includes Neo Financial / Neobanc high-yield float option", () => {
    const routes = scoreBillRoutes({
      payeeName: "DURHAM WATER, REG MUN OF",
      monthlyCad: 100,
      ownedCards: [],
    });

    const neo = routes.find((r) => r.intermediary.id === "neobanc");
    expect(neo).toBeDefined();
    expect(neo?.intermediary.type).toBe("fintechAccountRouting");
    expect(neo?.estimatedAnnualNetCad).toBeGreaterThan(0);
  });

  it("does not invent credit-card routes when the live wallet is empty", () => {
    const routes = scoreBillRoutes({ payeeName: "Toronto Hydro", monthlyCad: 100, ownedCards: [] });

    expect(routes.some((route) => route.intermediary.type === "creditIntermediary")).toBe(false);
    expect(routes.some((route) => route.intermediary.type === "cardDirectBillPay")).toBe(false);
    expect(routes.every((route) => route.cardId === null)).toBe(true);
  });

  it("uses exact contract eligibility for direct bill-pay cards", () => {
    const routes = scoreBillRoutes({
      payeeName: "City property tax",
      monthlyCad: 400,
      ownedCards: [
        walletCard("triangle-we", "Triangle ending 1234", 0.0095),
        walletCard("amex-cobalt", "Cobalt", 0.01),
      ],
    });

    const direct = routes.filter((route) => route.intermediary.id === "triangle-bill-pay");
    expect(direct).toHaveLength(1);
    expect(direct[0]).toMatchObject({
      cardId: "triangle-we",
      cardOfficialName: "Triangle ending 1234",
    });
  });
});
