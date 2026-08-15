import { describe, expect, it } from "vitest";
import { makeBill, makeProfile, makeSnapshot } from "./fixtures";
import { digitalNewsRule, mortgagePrepaymentRule, studentLoanInterestRule } from "./bill-rules";
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

describe("ALL_RULES after Phase 3", () => {
  it("has 22 uniquely-keyed rules including the bill rules", () => {
    const keys = ALL_RULES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining(["DIGITAL_NEWS", "STUDENT_LOAN_INTEREST", "MORTGAGE_PREPAYMENT"]),
    );
    expect(keys).toHaveLength(22);
  });
});
