import { describe, expect, it } from "vitest";
import { makeAccount, makeHolding, makeProfile, makeSnapshot, makeTx } from "./fixtures";
import { fhsaRoomRule, rdspLifetimeRule, staleDataRule, tfsaRoomRule } from "./rooms";

describe("tfsaRoomRule", () => {
  it("shows remaining room as an opportunity", () => {
    const profile = makeProfile({ tfsaRoomMinor: 1_000_000 }); // $10,000 as of Jan 1
    const tfsa = makeAccount({
      type: "TFSA",
      transactions: [makeTx({ type: "CONTRIBUTION", amountMinor: 400_000, date: "2026-02-01" })],
    });
    const alerts = tfsaRoomRule.evaluate(profile, makeSnapshot([tfsa]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("opportunity");
    expect(alerts[0].valueMinor).toBe(600_000);
  });

  it("goes critical on over-contribution", () => {
    const profile = makeProfile({ tfsaRoomMinor: 100_000 });
    const tfsa = makeAccount({
      type: "TFSA",
      transactions: [makeTx({ type: "CONTRIBUTION", amountMinor: 300_000, date: "2026-02-01" })],
    });
    const alerts = tfsaRoomRule.evaluate(profile, makeSnapshot([tfsa]));
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[0].message).toContain("1%");
  });

  it("is silent when no room figure was entered", () => {
    const alerts = tfsaRoomRule.evaluate(makeProfile(), makeSnapshot([makeAccount({ type: "TFSA" })]));
    expect(alerts).toHaveLength(0);
  });
});

describe("fhsaRoomRule", () => {
  it("also enforces the $8k annual cap independent of entered room", () => {
    const profile = makeProfile({ fhsaRoomMinor: 2_000_000 });
    const fhsa = makeAccount({
      type: "FHSA",
      transactions: [makeTx({ type: "CONTRIBUTION", amountMinor: 900_000, date: "2026-03-01" })],
    });
    const alerts = fhsaRoomRule.evaluate(profile, makeSnapshot([fhsa]));
    expect(alerts.some((a) => a.severity === "critical" && a.message.includes("annual"))).toBe(true);
  });
});

describe("rdspLifetimeRule", () => {
  it("goes critical when lifetime contributions would exceed $200k", () => {
    const profile = makeProfile({ rdspContribLifetimeMinor: 19_950_000 });
    const rdsp = makeAccount({
      type: "RDSP",
      transactions: [makeTx({ type: "CONTRIBUTION", amountMinor: 100_000, date: "2026-02-01" })],
    });
    const alerts = rdspLifetimeRule.evaluate(profile, makeSnapshot([rdsp]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("critical");
  });
});

describe("staleDataRule", () => {
  it("flags prices and FX older than 30 days", () => {
    const account = makeAccount({
      holdings: [makeHolding({ priceAsOf: "2026-05-01" })], // 105 days before 2026-08-14
    });
    const snapshot = makeSnapshot([account], {
      fxRates: [{ base: "USD", quote: "CAD", rate: 1.4, asOf: "2026-06-01" }],
    });
    const alerts = staleDataRule.evaluate(makeProfile(), snapshot);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toMatch(/1 holding price/);
    expect(alerts[0].message).toMatch(/1 FX rate/);
  });

  it("is silent when everything is fresh", () => {
    const account = makeAccount({ holdings: [makeHolding({ priceAsOf: "2026-08-10" })] });
    const snapshot = makeSnapshot([account], {
      fxRates: [{ base: "USD", quote: "CAD", rate: 1.4, asOf: "2026-08-10" }],
    });
    expect(staleDataRule.evaluate(makeProfile(), snapshot)).toHaveLength(0);
  });
});
