import { formatMinorUnits } from "../money";
import type { Currency } from "../money";
import type { Rule } from "./types";
import { currentYear } from "./types";

// Word-bounded so "Compost" does not read as "Post".
const NEWS_PATTERN = /\b(news|globe|star|post|gazette|herald|tribune|journal)\b/i;
const STUDENT_LOAN_PATTERN = /\b(student|nslc|osap)\b/i;

const DAY_MS = 86_400_000;

/** Whole days between two calendar dates, via UTC midnight — never local time. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / DAY_MS);
}

export const digitalNewsRule: Rule = {
  key: "DIGITAL_NEWS",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "ITA line 31350 — digital news subscription expenses (QCJO), up to $500",
  lastReviewed: "2026-08-14",
  evaluate(_profile, snapshot) {
    const candidates = snapshot.bills.filter(
      (b) => b.category === "subscriptions" && NEWS_PATTERN.test(`${b.name} ${b.notes ?? ""}`),
    );
    if (candidates.length === 0) return [];
    return [
      {
        ruleKey: "DIGITAL_NEWS",
        severity: "info",
        kind: "opportunity",
        entityRef: "",
        title: "Digital news subscription credit may apply",
        message: `These subscriptions look news-like: ${candidates.map((b) => b.name).join(", ")}. If any is with a Qualified Canadian Journalism Organization, line 31350 allows claiming up to $500 of the expense.`,
        action: "Check the CRA's QCJO list for your provider and keep the receipt for tax time.",
        citation: "ITA line 31350",
      },
    ];
  },
};

export const studentLoanInterestRule: Rule = {
  key: "STUDENT_LOAN_INTEREST",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "ITA line 31900 — interest on government student loans is a non-refundable credit",
  lastReviewed: "2026-08-14",
  evaluate(_profile, snapshot) {
    const year = currentYear(snapshot.today);
    const loans = snapshot.bills.filter(
      (b) => b.category === "debt" && STUDENT_LOAN_PATTERN.test(`${b.name} ${b.notes ?? ""}`),
    );
    if (loans.length === 0) return [];
    return loans.map((bill) => {
      const paidThisYear = bill.payments
        .filter((p) => p.paidAt && p.dueDate.slice(0, 4) === year)
        .reduce((sum, p) => sum + (p.actualAmountMinor ?? p.expectedAmountMinor), 0);
      return {
        ruleKey: "STUDENT_LOAN_INTEREST",
        severity: "info" as const,
        kind: "opportunity" as const,
        entityRef: bill.id,
        title: `${bill.name}: track the interest portion for tax time`,
        message: `${formatMinorUnits(paidThisYear, bill.currency as Currency)} in payments logged this year. Only the interest portion is claimable (line 31900) — the lender's annual statement shows the split, and unclaimed interest carries forward 5 years.`,
        action: "Download the annual interest statement from the lender's portal in January and give the interest figure to your tax prep.",
        citation: "ITA line 31900",
      };
    });
  },
};

export const mortgagePrepaymentRule: Rule = {
  key: "MORTGAGE_PREPAYMENT",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "Lender prepayment privilege (contract terms); rough saving = rate × amount",
  lastReviewed: "2026-08-14",
  evaluate(_profile, snapshot) {
    return snapshot.bills
      .filter((b) => b.category === "housing" && b.prepaymentMonthDay)
      .flatMap((bill) => {
        const year = Number(currentYear(snapshot.today));
        // Both this year's and next year's window, so a January window is still
        // announced from the preceding December instead of silently skipped.
        const upcoming = [`${year}-${bill.prepaymentMonthDay}`, `${year + 1}-${bill.prepaymentMonthDay}`]
          .map((windowDate) => ({ windowDate, daysUntil: daysBetween(snapshot.today, windowDate) }))
          .find(({ daysUntil }) => daysUntil >= 0 && daysUntil <= 60);
        if (!upcoming) return [];
        const { windowDate, daysUntil } = upcoming;
        const rateNote =
          bill.interestRatePct !== null
            ? ` At ${bill.interestRatePct}%, every $10,000 prepaid saves roughly ${formatMinorUnits(Math.round(1_000_000 * (bill.interestRatePct / 100)), "CAD")} of interest per year (first-year approximation).`
            : "";
        return [
          {
            ruleKey: "MORTGAGE_PREPAYMENT",
            severity: "info" as const,
            kind: "opportunity" as const,
            entityRef: bill.id,
            title: `${bill.name}: prepayment window ${bill.prepaymentMonthDay} (${daysUntil} days)`,
            message: `The annual lump-sum prepayment privilege window (${windowDate}) is ${daysUntil} day(s) away.${rateNote}`,
            action: "Decide the prepayment amount against your liquidity before the window — check the exact privilege percentage in the mortgage contract.",
            citation: "Mortgage contract prepayment terms",
          },
        ];
      });
  },
};
