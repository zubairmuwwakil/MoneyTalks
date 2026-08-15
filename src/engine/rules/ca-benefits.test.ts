import { describe, expect, it } from "vitest";
import { makeAccount, makeProfile, makeSnapshot } from "./fixtures";
import { cwbRule, dtcRule, employmentAmountRule, incomeSupportRule, nhtRule } from "./ca-benefits";
import { ALL_RULES } from "./index";

const employment = { name: "Job", amountMinor: 200_000, cadence: "MONTHLY" as const, kind: "EMPLOYMENT" as const };

describe("dtcRule", () => {
  it("reminds DTC-eligible users of the credit value", () => {
    const alerts = dtcRule.evaluate(makeProfile({ dtcEligible: true }), makeSnapshot([]));
    expect(alerts).toHaveLength(1);
    // 2026 verified figures: $10,341.00 disability amount x 14% lowest federal rate.
    expect(alerts[0].valueMinor).toBe(144_774);
  });

  it("is silent otherwise", () => {
    expect(dtcRule.evaluate(makeProfile(), makeSnapshot([]))).toHaveLength(0);
  });
});

describe("cwbRule", () => {
  it("flags likely eligibility for working income under the cutoff", () => {
    const profile = makeProfile({ incomeSources: [employment] }); // $24,000/yr
    const alerts = cwbRule.evaluate(profile, makeSnapshot([]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain("up to");
  });

  it("is silent above the net-income cutoff", () => {
    const rich = makeProfile({
      incomeSources: [{ ...employment, amountMinor: 400_000 }], // $48,000/yr
    });
    expect(cwbRule.evaluate(rich, makeSnapshot([]))).toHaveLength(0);
  });
});

describe("employmentAmountRule", () => {
  it("reminds about the CEA when employment income exists", () => {
    const alerts = employmentAmountRule.evaluate(makeProfile({ incomeSources: [employment] }), makeSnapshot([]));
    expect(alerts).toHaveLength(1);
    // 2026 verified figures: $1,501.00 x 14%.
    expect(alerts[0].valueMinor).toBe(21_014);
  });
});

describe("incomeSupportRule (OW)", () => {
  const owProfile = makeProfile({ benefitPrograms: ["OW"], incomeSources: [employment] }); // $2,000/mo earned

  it("computes the monthly clawback above the $200 exemption", () => {
    const alerts = incomeSupportRule.evaluate(owProfile, makeSnapshot([]));
    const earnings = alerts.find((a) => a.entityRef === "earnings");
    expect(earnings).toBeDefined();
    expect(earnings!.message).toContain("$900.00"); // (2000-200) × 50%
  });

  it("warns when countable assets approach the $10k limit", () => {
    const cash = makeAccount({ type: "CASH", balanceMinor: 900_000 }); // $9,000
    const rdsp = makeAccount({ type: "RDSP", balanceMinor: 5_000_000 }); // exempt
    const alerts = incomeSupportRule.evaluate(owProfile, makeSnapshot([cash, rdsp]));
    const assets = alerts.find((a) => a.entityRef === "assets");
    expect(assets).toBeDefined();
    expect(assets!.severity).toBe("warning");
    expect(assets!.message).toContain("$9,000.00");
    expect(assets!.message).not.toContain("$59,000.00"); // RDSP must be excluded
  });

  it("goes critical at or over the asset limit", () => {
    const cash = makeAccount({ type: "CASH", balanceMinor: 1_100_000 });
    const alerts = incomeSupportRule.evaluate(owProfile, makeSnapshot([cash]));
    expect(alerts.find((a) => a.entityRef === "assets")!.severity).toBe("critical");
  });

  it("is silent without an enrolled program", () => {
    expect(incomeSupportRule.evaluate(makeProfile(), makeSnapshot([]))).toHaveLength(0);
  });
});

describe("nhtRule", () => {
  it("reminds JM citizens who contributed", () => {
    const profile = makeProfile({ citizenships: ["US", "CA", "JM"], nhtContributed: true });
    expect(nhtRule.evaluate(profile, makeSnapshot([]))).toHaveLength(1);
  });

  it("is silent without contributions", () => {
    const profile = makeProfile({ citizenships: ["JM"] });
    expect(nhtRule.evaluate(profile, makeSnapshot([]))).toHaveLength(0);
  });
});

describe("ALL_RULES", () => {
  it("registers all 19 Phase-2 rule objects with unique keys", () => {
    const keys = ALL_RULES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining([
        "FBAR", "FORM_8938", "PFIC", "ROTH_FREEZE", "TFSA_US_DRAG", "TFSA_US_WITHHOLDING",
        "T1135", "TFSA_ROOM", "RRSP_ROOM", "FHSA_ROOM", "RDSP_LIFETIME", "STALE_DATA",
        "RDSP_CDSG", "RDSP_CDSB", "DTC", "CWB", "CANADA_EMPLOYMENT_AMOUNT", "INCOME_SUPPORT", "NHT",
      ]),
    );
    expect(keys).toHaveLength(19);
  });
});
