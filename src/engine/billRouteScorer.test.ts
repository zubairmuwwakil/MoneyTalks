import { describe, expect, it } from "vitest";
import { detectBillCategory, scoreBillRoutes } from "./billRouteScorer";

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
      ownedCardIds: ["scotiabank-momentum-vi", "triangle-we"],
    });

    expect(routes.length).toBeGreaterThan(0);
    const top = routes[0];
    expect(top.intermediary.id).toBe("chexy");
    expect(top.isOptimal).toBe(true);
    expect(top.netSpreadRate).toBeCloseTo(0.0225, 4);
    expect(top.estimatedAnnualNetCad).toBe(40.5);
  });

  it("recommends Triangle Bill Pay when Triangle is owned and no 4% card exists", () => {
    const routes = scoreBillRoutes({
      payeeName: "DURHAM WATER, REG MUN OF",
      monthlyCad: 200,
      ownedCardIds: ["triangle-we"],
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
      ownedCardIds: [],
    });

    const neo = routes.find((r) => r.intermediary.id === "neobanc");
    expect(neo).toBeDefined();
    expect(neo?.intermediary.type).toBe("fintechAccountRouting");
    expect(neo?.estimatedAnnualNetCad).toBeGreaterThan(0);
  });
});
