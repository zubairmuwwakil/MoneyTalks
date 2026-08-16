import { describe, expect, it } from "vitest";
import { makeAccount, makeHolding, makeProfile, makeSnapshot, makeTx } from "./rules/fixtures";
import { buildTaxChecklist } from "./taxchecklist";

describe("buildTaxChecklist", () => {
  it("marks FBAR REQUIRED and counts 8621s from PFIC hits", () => {
    const tfsa = makeAccount({
      type: "TFSA",
      currency: "USD",
      balanceMinor: 1_500_000, // $15k USD > $10k FBAR threshold
      snapshots: [{ balanceMinor: 1_500_000, asOf: "2026-02-01" }],
      holdings: [
        makeHolding({ symbol: "FAKE.TO", domicileCountry: "CA" }),
        makeHolding({ symbol: "ALSO.NE", domicileCountry: "CA" }),
      ],
    });
    const list = buildTaxChecklist(makeProfile(), makeSnapshot([tfsa]));
    const fbar = list.find((i) => i.item.includes("FinCEN 114"))!;
    expect(fbar.status).toBe("REQUIRED");
    expect(fbar.detail).toContain("$15,000.00");
    const pfic = list.find((i) => i.item.includes("8621"))!;
    expect(pfic.status).toBe("REQUIRED");
    expect(pfic.detail).toContain("2");
  });

  it("marks FBAR NOT_APPLICABLE when under threshold and includes RRSP contributions", () => {
    const rrsp = makeAccount({
      type: "RRSP",
      balanceMinor: 100_000,
      transactions: [makeTx({ type: "CONTRIBUTION", amountMinor: 250_000, date: "2026-03-01" })],
    });
    const list = buildTaxChecklist(makeProfile(), makeSnapshot([rrsp]));
    expect(list.find((i) => i.item.includes("FinCEN 114"))!.status).toBe("NOT_APPLICABLE");
    expect(list.find((i) => i.item.includes("RRSP"))!.detail).toContain("$2,500.00");
  });

  it("includes DTC only when eligible", () => {
    const withDtc = buildTaxChecklist(makeProfile({ dtcEligible: true }), makeSnapshot([]));
    const without = buildTaxChecklist(makeProfile(), makeSnapshot([]));
    expect(withDtc.some((i) => i.item.includes("Disability"))).toBe(true);
    expect(without.some((i) => i.item.includes("Disability"))).toBe(false);
  });

  it("sorts REQUIRED items ahead of everything else", () => {
    const tfsa = makeAccount({
      type: "TFSA",
      currency: "USD",
      balanceMinor: 1_500_000,
      snapshots: [{ balanceMinor: 1_500_000, asOf: "2026-02-01" }],
    });
    const list = buildTaxChecklist(makeProfile(), makeSnapshot([tfsa]));
    const firstOther = list.findIndex((i) => i.status !== "REQUIRED");
    const lastRequired = list.map((i) => i.status).lastIndexOf("REQUIRED");
    expect(lastRequired).toBeLessThan(firstOther);
  });
});
