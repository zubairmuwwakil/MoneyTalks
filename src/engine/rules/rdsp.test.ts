import { describe, expect, it } from "vitest";
import { makeAccount, makeProfile, makeSnapshot } from "./fixtures";
import { cdsbRule, cdsgPlan, cdsgRule } from "./rdsp";

describe("cdsgPlan", () => {
  it("spec acceptance: low tier, 1 carry-forward year, $0 contributed", () => {
    const profile = makeProfile({ rdspIncomeTier: "LOW", rdspCarryForwardYears: 1 });
    const plan = cdsgPlan(profile, 0);
    // Bands ×2 years: 300% on $1,000 → $3,000; 200% on $2,000 → $4,000. Total $7,000 ≤ $10,500 cap.
    expect(plan.optimalContributionMinor).toBe(300_000);
    expect(plan.grantAtOptimalMinor).toBe(700_000);
    expect(plan.additionalGrantMinor).toBe(700_000);
    expect(plan.effectiveMatchPct).toBe(233);
  });

  it("no carry-forward, low tier: $1,500 → $3,500", () => {
    const plan = cdsgPlan(makeProfile({ rdspIncomeTier: "LOW" }), 0);
    expect(plan.optimalContributionMinor).toBe(150_000);
    expect(plan.grantAtOptimalMinor).toBe(350_000);
  });

  it("caps the payable grant at $10,500 with heavy carry-forward", () => {
    const plan = cdsgPlan(makeProfile({ rdspIncomeTier: "LOW", rdspCarryForwardYears: 9 }), 0);
    expect(plan.grantAtOptimalMinor).toBe(1_050_000);
    // Greedy: $3,500 of 300% band contributions ($10,500 grant needs only part of the bands)
    expect(plan.optimalContributionMinor).toBe(350_000);
  });

  it("credits contributions already made this year", () => {
    const profile = makeProfile({ rdspIncomeTier: "LOW" });
    const plan = cdsgPlan(profile, 150_000); // already contributed the optimal amount
    expect(plan.additionalGrantMinor).toBe(0);
  });

  it("respects lifetime grant room", () => {
    const profile = makeProfile({ rdspIncomeTier: "LOW", rdspGrantsLifetimeMinor: 6_900_000 });
    const plan = cdsgPlan(profile, 0); // only $1,000 of grant room left
    // $1,000.00 room at a 300% match needs a $333.33⅓ contribution — impossible in integer
    // cents, so the engine rounds the contribution down and the max reachable grant is $999.99.
    expect(plan.optimalContributionMinor).toBe(33_333);
    expect(plan.grantAtOptimalMinor).toBe(99_999);
  });

  it("treats UNKNOWN tier as HIGH (conservative)", () => {
    const plan = cdsgPlan(makeProfile({ rdspIncomeTier: "UNKNOWN" }), 0);
    expect(plan.grantAtOptimalMinor).toBe(100_000); // 100% on $1,000
  });
});

describe("cdsgRule", () => {
  it("emits a warning-level opportunity naming the exact contribution", () => {
    const profile = makeProfile({ rdspIncomeTier: "LOW", rdspCarryForwardYears: 1 });
    const rdsp = makeAccount({ type: "RDSP" });
    const alerts = cdsgRule.evaluate(profile, makeSnapshot([rdsp]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("opportunity");
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].message).toContain("$3,000.00");
    expect(alerts[0].message).toContain("$7,000.00");
    expect(alerts[0].valueMinor).toBe(700_000);
  });

  it("suggests opening an RDSP when DTC-eligible but no account exists", () => {
    const profile = makeProfile({ dtcEligible: true });
    const alerts = cdsgRule.evaluate(profile, makeSnapshot([]));
    expect(alerts).toHaveLength(1);
    // "what to do next" lives in `action` per the Rule contract; the plan's test named
    // `message`, which is where the *why* lives.
    expect(alerts[0].action).toMatch(/open an RDSP/i);
    expect(alerts[0].message).toMatch(/no RDSP account exists/i);
  });

  it("is silent with no RDSP and no DTC eligibility", () => {
    expect(cdsgRule.evaluate(makeProfile(), makeSnapshot([]))).toHaveLength(0);
  });
});

describe("cdsbRule", () => {
  it("reminds LOW-tier holders the bond needs no contribution", () => {
    const profile = makeProfile({ rdspIncomeTier: "LOW" });
    const rdsp = makeAccount({ type: "RDSP" });
    const alerts = cdsbRule.evaluate(profile, makeSnapshot([rdsp]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].valueMinor).toBe(100_000);
  });

  it("is silent for HIGH tier", () => {
    const rdsp = makeAccount({ type: "RDSP" });
    expect(cdsbRule.evaluate(makeProfile({ rdspIncomeTier: "HIGH" }), makeSnapshot([rdsp]))).toHaveLength(0);
  });
});
