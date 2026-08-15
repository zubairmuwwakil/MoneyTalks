import { describe, expect, it } from "vitest";
import { makeAccount, makeHolding, makeProfile, makeSnapshot, makeTx } from "./fixtures";
import { pficRule, rothFreezeRule, t1135Rule, tfsaDragRule, tfsaWithholdingRule } from "./cross-border";

const profile = makeProfile();

describe("pficRule (spec acceptance)", () => {
  const veqt = makeHolding({ symbol: "VEQT.TO", domicileCountry: "CA" });

  it("flags a Canadian-listed fund in a TFSA as CRITICAL", () => {
    const tfsa = makeAccount({ type: "TFSA", holdings: [veqt] });
    const alerts = pficRule.evaluate(profile, makeSnapshot([tfsa]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[0].message).toContain("VEQT.TO");
    expect(alerts[0].entityRef).toBe(veqt.id);
  });

  it("is silent for the same holding in an RRSP", () => {
    const rrsp = makeAccount({ type: "RRSP", holdings: [makeHolding({ symbol: "VEQT.TO" })] });
    expect(pficRule.evaluate(profile, makeSnapshot([rrsp]))).toHaveLength(0);
  });

  it("catches US-domiciled-flag mismatches by ticker suffix", () => {
    const tfsa = makeAccount({
      type: "TFSA",
      holdings: [makeHolding({ symbol: "XYZ.NE", domicileCountry: "US" })],
    });
    expect(pficRule.evaluate(profile, makeSnapshot([tfsa]))).toHaveLength(1);
  });
});

describe("rothFreezeRule", () => {
  it("flags a logged Roth contribution while resident in Canada", () => {
    const roth = makeAccount({
      type: "ROTH_IRA",
      isUSSitus: true,
      currency: "USD",
      transactions: [makeTx({ type: "CONTRIBUTION", currency: "USD", date: "2026-05-01" })],
    });
    const alerts = rothFreezeRule.evaluate(profile, makeSnapshot([roth]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("critical");
  });

  it("is silent when residency is not CA", () => {
    const roth = makeAccount({
      type: "ROTH_IRA",
      transactions: [makeTx({ type: "CONTRIBUTION" })],
    });
    const usProfile = makeProfile({ residency: "US" });
    expect(rothFreezeRule.evaluate(usProfile, makeSnapshot([roth]))).toHaveLength(0);
  });
});

describe("tfsaDragRule", () => {
  it("annotates every TFSA and estimates drag from this year's income transactions", () => {
    const tfsa = makeAccount({
      type: "TFSA",
      transactions: [
        makeTx({ type: "DIVIDEND", amountMinor: 100_000, date: "2026-03-01" }),
        makeTx({ type: "INTEREST", amountMinor: 20_000, date: "2026-04-01" }),
        makeTx({ type: "DIVIDEND", amountMinor: 50_000, date: "2025-03-01" }), // prior year — excluded
      ],
    });
    const alerts = tfsaDragRule.evaluate(profile, makeSnapshot([tfsa]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].valueMinor).toBe(28_800); // (100000+20000) * 24%
    expect(alerts[0].message).not.toContain("tax-free");
  });
});

describe("tfsaWithholdingRule", () => {
  it("flags US-domiciled holdings inside a TFSA", () => {
    const tfsa = makeAccount({
      type: "TFSA",
      holdings: [makeHolding({ symbol: "VTI", domicileCountry: "US" })],
    });
    const alerts = tfsaWithholdingRule.evaluate(profile, makeSnapshot([tfsa]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain("15%");
  });
});

describe("t1135Rule", () => {
  it("warns when non-registered foreign cost exceeds CAD $100k", () => {
    const nonReg = makeAccount({
      type: "NON_REGISTERED",
      holdings: [
        makeHolding({ symbol: "VTI", domicileCountry: "US", bookCostMinor: 8_000_000 }), // USD? cost tracked in account currency CAD here
        makeHolding({ symbol: "AAPL", domicileCountry: "US", bookCostMinor: 3_000_000 }),
      ],
    });
    const alerts = t1135Rule.evaluate(profile, makeSnapshot([nonReg]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
  });

  it("ignores registered accounts and CA-domiciled holdings", () => {
    const rrsp = makeAccount({
      type: "RRSP",
      holdings: [makeHolding({ domicileCountry: "US", bookCostMinor: 20_000_000 })],
    });
    const nonRegCa = makeAccount({
      type: "NON_REGISTERED",
      holdings: [makeHolding({ domicileCountry: "CA", bookCostMinor: 20_000_000 })],
    });
    expect(t1135Rule.evaluate(profile, makeSnapshot([rrsp, nonRegCa]))).toHaveLength(0);
  });
});
