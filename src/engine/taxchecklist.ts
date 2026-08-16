import { formatMinorUnits } from "./money";
import { pficRule, t1135Rule } from "./rules/cross-border";
import { THRESHOLDS } from "./rules/thresholds";
import type { FinancialSnapshot, ProfileView } from "./rules/types";
import { currentYear, txsThisYear } from "./rules/types";
import { maxForeignAggregateUsd } from "./rules/us-reporting";

export type ChecklistStatus = "REQUIRED" | "LIKELY" | "CHECK" | "NOT_APPLICABLE";

export interface ChecklistItem {
  item: string;
  status: ChecklistStatus;
  detail: string;
}

const STATUS_ORDER: Record<ChecklistStatus, number> = {
  REQUIRED: 0,
  LIKELY: 1,
  CHECK: 2,
  NOT_APPLICABLE: 3,
};

const STUDENT_LOAN_PATTERN = /\b(student|nslc|osap)\b/i;

/**
 * Assembles the January tax-season checklist purely by composing engines that are
 * already tested elsewhere — no new thresholds and no new arithmetic live here. Every
 * dollar figure and every trigger comes from the same rule that raises the alert on
 * the Money Finder, so the checklist can never disagree with the dashboard.
 *
 * This flags that a form is likely required. It never fills one, and it is not advice.
 */
export function buildTaxChecklist(
  profile: ProfileView,
  snapshot: FinancialSnapshot,
): ChecklistItem[] {
  const year = currentYear(snapshot.today);
  const items: ChecklistItem[] = [];

  // --- US filings -------------------------------------------------------------
  const { maxMinor, currentMinor } = maxForeignAggregateUsd(snapshot);
  const fbarTriggered = maxMinor > THRESHOLDS.FBAR_AGGREGATE_USD;
  items.push({
    item: "FinCEN 114 (FBAR)",
    status: fbarTriggered ? "REQUIRED" : "NOT_APPLICABLE",
    detail: fbarTriggered
      ? `Non-US accounts peaked at ${formatMinorUnits(maxMinor, "USD")} during ${year}, over the $10,000 aggregate. The obligation is locked in for the year even if the balance has since fallen (now ${formatMinorUnits(currentMinor, "USD")}).`
      : `Peak non-US aggregate for ${year} was ${formatMinorUnits(maxMinor, "USD")}, under the $10,000 threshold. Crossing it once at any point would trigger a filing.`,
  });

  const t = THRESHOLDS.FORM_8938[profile.filingStatus];
  const over8938AnyTime = maxMinor > t.anyTimeUsd;
  const over8938YearEnd = currentMinor > t.yearEndUsd;
  items.push({
    item: "Form 8938 (FATCA)",
    status: over8938AnyTime ? "REQUIRED" : over8938YearEnd ? "LIKELY" : "NOT_APPLICABLE",
    detail: over8938AnyTime
      ? `Peak ${formatMinorUnits(maxMinor, "USD")} exceeds the ${formatMinorUnits(t.anyTimeUsd, "USD")} any-time threshold for your filing status.`
      : over8938YearEnd
        ? `Current ${formatMinorUnits(currentMinor, "USD")} exceeds the ${formatMinorUnits(t.yearEndUsd, "USD")} year-end threshold — confirm the Dec 31 figure.`
        : `Under both the ${formatMinorUnits(t.yearEndUsd, "USD")} year-end and ${formatMinorUnits(t.anyTimeUsd, "USD")} any-time thresholds for your filing status.`,
  });

  const pficHits = pficRule.evaluate(profile, snapshot);
  items.push({
    item: "Form 8621 (PFIC)",
    status: pficHits.length > 0 ? "REQUIRED" : "NOT_APPLICABLE",
    detail:
      pficHits.length > 0
        ? `${pficHits.length} suspected PFIC holding(s) outside an RRSP — one Form 8621 per fund, per year: ${pficHits.map((a) => a.title.replace("PFIC risk: ", "")).join("; ")}.`
        : "No Canadian-domiciled funds detected outside an RRSP.",
  });

  const tfsaUsIncome = snapshot.accounts
    .filter((a) => a.type === "TFSA")
    .flatMap((a) => txsThisYear(a, snapshot.today))
    .filter((tx) => tx.type === "DIVIDEND" || tx.type === "INTEREST")
    .reduce((sum, tx) => sum + tx.amountMinor, 0);
  if (profile.citizenships.includes("US")) {
    items.push({
      item: "TFSA income for the 1040",
      status: tfsaUsIncome > 0 ? "REQUIRED" : "CHECK",
      detail:
        tfsaUsIncome > 0
          ? `${formatMinorUnits(tfsaUsIncome, "CAD")} of dividends/interest logged inside TFSAs this year. A TFSA is not tax-free for a US person — this is reportable US income.`
          : "No TFSA dividends or interest logged this year. Confirm against the slips — a TFSA is not tax-free for a US person.",
    });
  }

  // --- Canadian filings and claims --------------------------------------------
  const t1135Hits = t1135Rule.evaluate(profile, snapshot);
  items.push({
    item: "Form T1135 (foreign property)",
    status: t1135Hits.length > 0 ? "CHECK" : "NOT_APPLICABLE",
    detail:
      t1135Hits.length > 0
        ? `${t1135Hits[0].message} Confirm scope with your accountant.`
        : "Specified foreign property cost is under the CAD $100,000 threshold on the app's heuristic.",
  });

  const rrspContribMinor = snapshot.accounts
    .filter((a) => a.type === "RRSP")
    .flatMap((a) => txsThisYear(a, snapshot.today, "CONTRIBUTION"))
    .reduce((sum, tx) => sum + tx.amountMinor, 0);
  items.push({
    item: "RRSP contribution receipts",
    status: rrspContribMinor > 0 ? "REQUIRED" : "CHECK",
    detail: `${formatMinorUnits(rrspContribMinor, "CAD")} in RRSP contributions logged for ${year}. Collect the slips, and remember first-60-days contributions must be reported on the prior year's return even if you claim them later.`,
  });

  const studentLoans = snapshot.bills.filter(
    (b) => b.category === "debt" && STUDENT_LOAN_PATTERN.test(`${b.name} ${b.notes ?? ""}`),
  );
  if (studentLoans.length > 0) {
    items.push({
      item: "Student loan interest statement",
      status: "CHECK",
      detail: `Matching bill(s): ${studentLoans.map((b) => b.name).join(", ")}. Only the interest portion is claimable (line 31900); the lender's annual statement shows the split, and unclaimed interest carries forward 5 years.`,
    });
  }

  if (profile.dtcEligible) {
    items.push({
      item: "Disability Tax Credit (line 31600)",
      status: "REQUIRED",
      detail: `Claim the disability amount of ${formatMinorUnits(THRESHOLDS.DTC_FEDERAL_AMOUNT, "CAD")} for ${year}, valued at the ${THRESHOLDS.FEDERAL_CREDIT_RATE_PCT}% lowest federal rate. Certificate T2201 must be on file with the CRA.`,
    });
  }

  const employmentIncomeMinor = profile.incomeSources
    .filter((s) => s.kind === "EMPLOYMENT")
    .reduce((sum, s) => sum + (s.cadence === "MONTHLY" ? s.amountMinor * 12 : s.cadence === "BIWEEKLY" ? s.amountMinor * 26 : s.amountMinor), 0);
  if (employmentIncomeMinor > 0) {
    items.push({
      item: "Canada Employment Amount (line 31260)",
      status: "LIKELY",
      detail: `Employment income on file, so the flat ${formatMinorUnits(THRESHOLDS.CANADA_EMPLOYMENT_AMOUNT, "CAD")} claim applies. Most tax software applies it automatically — verify it appears.`,
    });
    const cwbLikely =
      employmentIncomeMinor >= THRESHOLDS.CWB.MIN_WORKING_INCOME &&
      employmentIncomeMinor < THRESHOLDS.CWB.NET_INCOME_CUTOFF_SINGLE;
    items.push({
      item: "Canada Workers Benefit (Schedule 6)",
      status: cwbLikely ? "LIKELY" : "NOT_APPLICABLE",
      detail: cwbLikely
        ? `Annualized employment income ${formatMinorUnits(employmentIncomeMinor, "CAD")} falls inside the CWB range (over ${formatMinorUnits(THRESHOLDS.CWB.MIN_WORKING_INCOME, "CAD")}, under the ${formatMinorUnits(THRESHOLDS.CWB.NET_INCOME_CUTOFF_SINGLE, "CAD")} single cutoff). File Schedule 6.`
        : `Annualized employment income ${formatMinorUnits(employmentIncomeMinor, "CAD")} is outside the single-filer CWB range.`,
    });
  }

  return items.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}
