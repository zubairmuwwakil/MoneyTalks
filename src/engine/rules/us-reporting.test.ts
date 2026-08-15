import { describe, expect, it } from "vitest";
import { makeAccount, makeProfile, makeSnapshot } from "./fixtures";
import { fbarRule, form8938Rule, maxForeignAggregateUsd } from "./us-reporting";

const profile = makeProfile();

describe("maxForeignAggregateUsd", () => {
  it("takes the max over the year of forward-filled snapshots plus today's live balances", () => {
    const account = makeAccount({
      currency: "CAD",
      balanceMinor: 700_000, // live today: 7,000 CAD = 5,000 USD
      snapshots: [
        { balanceMinor: 2_100_000, asOf: "2026-03-01" }, // 21,000 CAD = 15,000 USD peak
        { balanceMinor: 700_000, asOf: "2026-06-01" },
      ],
    });
    const snapshot = makeSnapshot([account]);
    const { maxMinor, currentMinor } = maxForeignAggregateUsd(snapshot);
    expect(maxMinor).toBe(1_500_000);
    expect(currentMinor).toBe(500_000);
  });

  it("ignores US-situs accounts", () => {
    const us = makeAccount({ isUSSitus: true, currency: "USD", balanceMinor: 5_000_000 });
    const snapshot = makeSnapshot([us]);
    expect(maxForeignAggregateUsd(snapshot).maxMinor).toBe(0);
  });
});

describe("fbarRule", () => {
  it("reports TRIGGERED as a warning when the max aggregate exceeds $10,000 USD", () => {
    const account = makeAccount({
      currency: "USD",
      balanceMinor: 1_100_000,
      snapshots: [{ balanceMinor: 1_100_000, asOf: "2026-02-01" }],
    });
    const alerts = fbarRule.evaluate(profile, makeSnapshot([account]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].message).toContain("FinCEN 114");
  });

  it("reports SAFE as info when under the threshold", () => {
    const account = makeAccount({ currency: "CAD", balanceMinor: 100_000 });
    const alerts = fbarRule.evaluate(profile, makeSnapshot([account]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("info");
    expect(alerts[0].title).toContain("SAFE");
  });
});

describe("form8938Rule", () => {
  it("is silent well under the single-abroad thresholds", () => {
    const account = makeAccount({ currency: "USD", balanceMinor: 1_000_000 });
    expect(form8938Rule.evaluate(profile, makeSnapshot([account]))).toHaveLength(0);
  });

  it("warns when the any-time aggregate crosses $300k (single abroad)", () => {
    const account = makeAccount({
      currency: "USD",
      balanceMinor: 31_000_000,
      snapshots: [{ balanceMinor: 31_000_000, asOf: "2026-04-01" }],
    });
    const alerts = form8938Rule.evaluate(profile, makeSnapshot([account]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].message).toContain("8938");
  });
});
