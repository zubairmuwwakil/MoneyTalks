import { describe, expect, it } from "vitest";
import { makeAccount, makeBill, makeProfile, makeSnapshot } from "./fixtures";
import { dangerMonthRule, digitalNewsRule, mortgagePrepaymentRule, studentLoanInterestRule } from "./bill-rules";
import { ALL_RULES } from "./index";

const profile = makeProfile();

describe("digitalNewsRule", () => {
  it("suggests the credit for news-like subscriptions, hedged", () => {
    const snapshot = makeSnapshot([], {
      bills: [makeBill({ name: "Fictional Star News", category: "subscriptions" })],
    });
    const alerts = digitalNewsRule.evaluate(profile, snapshot);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toMatch(/if .*qualif/i);
  });

  it("is silent without news-like bills", () => {
    const snapshot = makeSnapshot([], { bills: [makeBill({ name: "Fixture Gym" })] });
    expect(digitalNewsRule.evaluate(profile, snapshot)).toHaveLength(0);
  });

  it("does not match a news word buried inside another word", () => {
    const snapshot = makeSnapshot([], {
      bills: [makeBill({ name: "Fixture Compost Pickup", category: "subscriptions" })],
    });
    expect(digitalNewsRule.evaluate(profile, snapshot)).toHaveLength(0);
  });
});

describe("studentLoanInterestRule", () => {
  it("sums this year's paid amounts on student-loan-like bills", () => {
    const snapshot = makeSnapshot([], {
      bills: [
        makeBill({
          name: "Fixture Student Loan",
          category: "debt",
          payments: [
            { dueDate: "2026-02-05", expectedAmountMinor: 20_000, actualAmountMinor: 20_000, paidAt: "2026-02-05" },
            { dueDate: "2026-03-05", expectedAmountMinor: 20_000, actualAmountMinor: 20_000, paidAt: "2026-03-05" },
            { dueDate: "2025-12-05", expectedAmountMinor: 20_000, actualAmountMinor: 20_000, paidAt: "2025-12-05" }, // prior year
          ],
        }),
      ],
    });
    const alerts = studentLoanInterestRule.evaluate(profile, snapshot);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain("$400.00"); // 2 × 200.00 this year
    expect(alerts[0].message).toMatch(/interest portion/i);
  });

  it("is silent without student-loan-like bills", () => {
    expect(studentLoanInterestRule.evaluate(profile, makeSnapshot([], { bills: [] }))).toHaveLength(0);
  });
});

describe("mortgagePrepaymentRule", () => {
  it("reminds within 60 days before the window", () => {
    const snapshot = makeSnapshot([], {
      today: "2026-02-01",
      bills: [makeBill({ name: "Fixture Mortgage", category: "housing", prepaymentMonthDay: "03-15", interestRatePct: 5 })],
    });
    const alerts = mortgagePrepaymentRule.evaluate(profile, snapshot);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain("03-15");
    expect(alerts[0].message).toContain("$500.00"); // per $10,000 at 5%
  });

  it("is silent outside the 60-day window and without the metadata", () => {
    const far = makeSnapshot([], {
      today: "2026-09-01",
      bills: [makeBill({ category: "housing", prepaymentMonthDay: "03-15" })],
    });
    expect(mortgagePrepaymentRule.evaluate(profile, far)).toHaveLength(0);
    const noMeta = makeSnapshot([], { bills: [makeBill({ category: "housing" })] });
    expect(mortgagePrepaymentRule.evaluate(profile, noMeta)).toHaveLength(0);
  });

  // Deviation from the plan, agreed with the owner: the plan only built the
  // window date for the CURRENT year, so an early-year window was never
  // announced — on Dec 20 a Jan 15 window is 26 days out, but `2026-01-15` is
  // in the past and the reminder stayed silent through its whole approach.
  it("reaches across the year boundary for an early-year window", () => {
    const snapshot = makeSnapshot([], {
      today: "2026-12-20",
      bills: [makeBill({ name: "Fixture Mortgage", category: "housing", prepaymentMonthDay: "01-15" })],
    });
    const alerts = mortgagePrepaymentRule.evaluate(profile, snapshot);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain("2027-01-15");
    expect(alerts[0].message).toContain("26 day");
  });
});

describe("dangerMonthRule", () => {
  // Scenario, hand-derived (see task-6b-report.md for the full derivation):
  //   today = 2026-01-01, cushionMinor = $1,000.00 (100_000 minor)
  //   start balance: one CAD CASH account at $2,000.00 (200_000 minor)
  //   income: MONTHLY $1,000.00 on the 1st of every month
  //   bill: ANNUAL $4,200.00 (420_000 minor), anchored 2026-03-10 — one occurrence in
  //     the 12-month window (the next, 2027-03-10, falls just outside it)
  //   window: 2026-01-01 .. 2026-12-31 inclusive — one day short of the anniversary, so
  //     it spans exactly 12 calendar buckets rather than 12 months plus a lone extra day
  //
  //   Running balance at each event date:
  //     2026-01-01   200_000 + 100_000       = 300_000   (Jan min)
  //     2026-02-01   300_000 + 100_000       = 400_000   (Feb min)
  //     2026-03-01   400_000 + 100_000       = 500_000
  //     2026-03-10   500_000 - 420_000(bill) =  80_000   (Mar min — DANGER, < 100_000)
  //     2026-04-01    80_000 + 100_000       = 180_000   (Apr min — not danger)
  //   From April on it is pure +100_000/month income growth, so the balance never
  //   dips again. Exactly one danger month: 2026-03, minBalanceMinor 80_000,
  //   minDate 2026-03-10.
  const cushionProfile = makeProfile({
    cushionMinor: 100_000,
    incomeSources: [{ name: "Fixture Salary", amountMinor: 100_000, cadence: "MONTHLY", kind: "EMPLOYMENT" }],
  });
  const cashAccount = makeAccount({ type: "CASH", currency: "CAD", balanceMinor: 200_000 });
  const annualBill = makeBill({
    name: "Fixture Annual Insurance",
    cadence: { type: "ANNUAL", anchor: "2026-03-10" },
    schedule: [{ from: "2020-01-01", amountMinor: 420_000 }],
  });

  it("flags the hand-derived dip month with its minimum balance and date", () => {
    const snapshot = makeSnapshot([cashAccount], { today: "2026-01-01", bills: [annualBill] });
    const alerts = dangerMonthRule.evaluate(cushionProfile, snapshot);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].kind).toBe("compliance");
    expect(alerts[0].title).toContain("1 month(s) over the next 12 months");
    expect(alerts[0].message).toContain("2026-03: $800.00 on 2026-03-10");
    expect(alerts[0].action).toMatch(/cushion/i);
    expect(alerts[0].action).toMatch(/BIWEEKLY every 14 days/i);
  });

  it("does not fabricate a projection when no cash account backs it", () => {
    // A cushion with no CASH/CHEQUING account would otherwise roll forward from a
    // start balance of 0 and flag every month — a maximal false alarm built on nothing.
    const snapshot = makeSnapshot([], { today: "2026-01-01", bills: [annualBill] });
    const alerts = dangerMonthRule.evaluate(cushionProfile, snapshot);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("info");
    expect(alerts[0].title).toContain("no cash account");
    expect(alerts[0].message).not.toMatch(/dips|below your/i);
  });

  it("is silent when no cushion is configured (cushionMinor: 0)", () => {
    const noCushionProfile = makeProfile({ cushionMinor: 0, incomeSources: cushionProfile.incomeSources });
    const snapshot = makeSnapshot([cashAccount], { today: "2026-01-01", bills: [annualBill] });
    expect(dangerMonthRule.evaluate(noCushionProfile, snapshot)).toHaveLength(0);
  });

  it("skips a CASH/CHEQUING account with no FX rate to CAD instead of throwing, and names it in the alert", () => {
    const noRateAccount = makeAccount({
      name: "Fixture JA Chequing",
      type: "CHEQUING",
      currency: "JMD",
      balanceMinor: 5_000_000, // would change the outcome if counted — it must not be
    });
    const snapshot = makeSnapshot([cashAccount, noRateAccount], {
      today: "2026-01-01",
      bills: [annualBill],
      fxRates: [{ base: "USD", quote: "CAD", rate: 1.4, asOf: "2026-01-01" }], // no JMD rate either direction
    });
    expect(() => dangerMonthRule.evaluate(cushionProfile, snapshot)).not.toThrow();
    const alerts = dangerMonthRule.evaluate(cushionProfile, snapshot);
    expect(alerts).toHaveLength(1);
    // Same dip as the base scenario — the JMD account was excluded, not counted.
    expect(alerts[0].message).toContain("2026-03: $800.00 on 2026-03-10");
    expect(alerts[0].message).toContain("Fixture JA Chequing was excluded, no FX rate");
  });
});

describe("ALL_RULES after Phase 3", () => {
  it("has 23 uniquely-keyed rules including the bill rules", () => {
    const keys = ALL_RULES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining(["DIGITAL_NEWS", "STUDENT_LOAN_INTEREST", "MORTGAGE_PREPAYMENT", "DANGER_MONTH"]),
    );
    expect(keys).toHaveLength(23);
  });
});
