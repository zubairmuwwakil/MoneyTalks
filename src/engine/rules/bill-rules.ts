import { billOccurrences } from "../billforecast";
import { dangerMonths, incomeEvents, projectDailyBalance, type CashEvent } from "../dangermonth";
import { convertMinor, MissingFxRateError } from "../fx";
import { formatMinorUnits } from "../money";
import type { Currency } from "../money";
import type { FinancialSnapshot, ProfileView, Rule } from "./types";
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

const CUSHION_ACCOUNT_TYPES = new Set(["CASH", "CHEQUING"]);

/**
 * Adds `months` calendar months to an ISO date, day-clamped to the target month's
 * length — the same clamping rule as recurrence.ts's internal clampedDate.
 */
function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function addMonthsIso(date: string, months: number): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

export interface CashCushionProjection {
  series: Array<{ date: string; balanceMinor: number }>;
  excludedAccountNames: string[];
  /** CASH/CHEQUING accounts that actually contributed to the start balance. Zero means
   *  the projection has no real footing and must not be presented as one. */
  contributingAccounts: number;
}

/**
 * Projects the daily CAD cash balance across CASH/CHEQUING accounts over the next
 * `monthsAhead` months (default 12): start balance is those accounts' CAD-converted
 * balances, events are income (see incomeEvents — MONTHLY on the 1st, BIWEEKLY every
 * 14 days from `snapshot.today`, ANNUAL on Jan 1; a documented v1 approximation) minus
 * every bill occurrence in the same window, negated. Bill amounts are summed at face
 * value in whatever currency they carry — the same documented caveat as
 * forecastMonths in billforecast.ts, not re-derived here.
 *
 * A CASH/CHEQUING account whose currency has no FX rate to CAD is SKIPPED, not
 * thrown: one stray foreign-currency account should degrade this feature to a
 * partial answer, not blank it entirely via the rule-error path in registry.ts.
 * Exported so the forecast page can render the same projection as a "Min balance"
 * column without duplicating this logic.
 */
export function projectCashCushion(
  profile: ProfileView,
  snapshot: FinancialSnapshot,
  monthsAhead = 12,
): CashCushionProjection {
  const from = snapshot.today;
  // One day short of the anniversary: a window ending ON it would add a lone extra day
  // in a 13th calendar bucket, which dangerMonths would report as a whole "month".
  const to = addDaysIso(addMonthsIso(from, monthsAhead), -1);

  const excludedAccountNames: string[] = [];
  let startMinor = 0;
  let contributingAccounts = 0;
  for (const account of snapshot.accounts) {
    if (!CUSHION_ACCOUNT_TYPES.has(account.type)) continue;
    try {
      startMinor += convertMinor(account.balanceMinor, account.currency, "CAD", snapshot.fxRates);
      contributingAccounts += 1;
    } catch (e) {
      if (!(e instanceof MissingFxRateError)) throw e;
      excludedAccountNames.push(account.name);
    }
  }

  const incomeCashEvents = incomeEvents(profile.incomeSources, from, to);
  const billCashEvents: CashEvent[] = snapshot.bills.flatMap((bill) =>
    billOccurrences(
      {
        id: bill.id,
        name: bill.name,
        category: bill.category,
        currency: bill.currency,
        autopay: false,
        variable: false,
        cadence: bill.cadence,
        schedule: bill.schedule,
      },
      from,
      to,
    ).map((o) => ({ date: o.date, amountMinor: -o.amountMinor, label: o.billName })),
  );

  const series = projectDailyBalance(startMinor, [...incomeCashEvents, ...billCashEvents], from, to);
  return { series, excludedAccountNames, contributingAccounts };
}

export const dangerMonthRule: Rule = {
  key: "DANGER_MONTH",
  jurisdiction: "CROSS",
  kind: "compliance",
  citation: "Internal cash-flow projection policy — cushion configured in Settings",
  lastReviewed: "2026-08-15",
  evaluate(profile, snapshot) {
    if (profile.cushionMinor <= 0) return []; // silent until the owner sets a cushion
    const { series, excludedAccountNames, contributingAccounts } = projectCashCushion(profile, snapshot);
    // With no usable CASH/CHEQUING account the start balance would be a fabricated 0,
    // and every month would "dip below the cushion" — a maximal false alarm built on
    // nothing. Say what is missing instead of inventing a projection.
    if (contributingAccounts === 0) {
      return [
        {
          ruleKey: "DANGER_MONTH",
          severity: "info",
          kind: "compliance",
          entityRef: "",
          title: "Cash cushion set, but no cash account to project from",
          message:
            excludedAccountNames.length > 0
              ? `Your cushion is ${formatMinorUnits(profile.cushionMinor, "CAD")}, but every cash account was excluded for want of an FX rate: ${excludedAccountNames.join(", ")}.`
              : `Your cushion is ${formatMinorUnits(profile.cushionMinor, "CAD")}, but no CASH or CHEQUING account is tracked, so there is no balance to roll forward.`,
          action:
            excludedAccountNames.length > 0
              ? "Add an FX rate for those accounts' currency, then the danger-month projection can run."
              : "Add your day-to-day chequing or cash account under Investments, then the danger-month projection can run.",
          citation: "Internal cash-flow projection policy",
        },
      ];
    }
    const danger = dangerMonths(series, profile.cushionMinor);
    if (danger.length === 0) return [];

    const top3 = danger.slice(0, 3);
    const list = top3
      .map((m) => `${m.month}: ${formatMinorUnits(m.minBalanceMinor, "CAD")} on ${m.minDate}`)
      .join("; ");
    const more = danger.length > 3 ? ` (+${danger.length - 3} more month(s))` : "";
    const exclusionNote =
      excludedAccountNames.length > 0
        ? ` (projected from your CAD accounts; ${excludedAccountNames.join(", ")} was excluded, no FX rate)`
        : "";

    return [
      {
        ruleKey: "DANGER_MONTH",
        severity: "warning",
        kind: "compliance",
        entityRef: "",
        title: `Cash cushion dips below target in ${danger.length} month(s) over the next 12 months`,
        message: `Below your ${formatMinorUnits(profile.cushionMinor, "CAD")} cushion${exclusionNote}: ${list}${more}.`,
        action:
          "Raise the cushion in Settings, or plan cash flow around these dips. Income timing is a v1 approximation (MONTHLY on the 1st, BIWEEKLY every 14 days from today, ANNUAL on Jan 1) — pay-date precision is future work.",
        citation: "Internal cash-flow projection policy",
      },
    ];
  },
};
