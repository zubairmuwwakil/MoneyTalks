import { convertMinor } from "../fx";
import { formatMinorUnits } from "../money";
import { netWorthSeries } from "../networth";
import { THRESHOLDS } from "./thresholds";
import type { FinancialSnapshot, Rule } from "./types";
import { currentYear } from "./types";

export function maxForeignAggregateUsd(snapshot: FinancialSnapshot): {
  maxMinor: number;
  currentMinor: number;
} {
  const foreign = snapshot.accounts.filter((a) => !a.isUSSitus);
  const snapRows = foreign.flatMap((a) =>
    a.snapshots.map((s) => ({
      accountId: a.id,
      balanceMinor: s.balanceMinor,
      currency: a.currency,
      asOf: s.asOf,
    })),
  );
  const series = netWorthSeries(
    snapRows,
    "USD",
    snapshot.fxRates,
    `${currentYear(snapshot.today)}-01-01`,
    snapshot.today,
  );
  const currentMinor = foreign.reduce(
    (sum, a) => sum + convertMinor(a.balanceMinor, a.currency, "USD", snapshot.fxRates),
    0,
  );
  const maxMinor = Math.max(currentMinor, 0, ...series.map((p) => p.totalMinor));
  return { maxMinor, currentMinor };
}

export const fbarRule: Rule = {
  key: "FBAR",
  jurisdiction: "US",
  kind: "compliance",
  citation: "31 CFR 1010.350 — FinCEN Form 114",
  lastReviewed: "2026-08-15",
  evaluate(_profile, snapshot) {
    const { maxMinor, currentMinor } = maxForeignAggregateUsd(snapshot);
    const triggered = maxMinor > THRESHOLDS.FBAR_AGGREGATE_USD;
    return [
      {
        ruleKey: "FBAR",
        severity: triggered ? "warning" : "info",
        kind: "compliance",
        entityRef: "",
        title: triggered ? "FBAR: TRIGGERED this year" : "FBAR: SAFE so far this year",
        message: triggered
          ? `Your non-US accounts peaked at ${formatMinorUnits(maxMinor, "USD")} (now ${formatMinorUnits(currentMinor, "USD")}) — over the $10,000 aggregate, so FinCEN 114 is required for this calendar year.`
          : `Non-US aggregate peak so far: ${formatMinorUnits(maxMinor, "USD")} of the $10,000 USD threshold.`,
        action: triggered
          ? "File FinCEN Form 114 with next year's US filings — the obligation is already locked in for this year."
          : "No filing triggered yet. The meter watches the max, not the current balance — crossing once is enough.",
        citation: "31 CFR 1010.350",
        valueMinor: maxMinor,
        valueCurrency: "USD",
      },
    ];
  },
};

export const form8938Rule: Rule = {
  key: "FORM_8938",
  jurisdiction: "US",
  kind: "compliance",
  citation: "26 CFR 1.6038D-2 — IRS Form 8938 (FATCA)",
  lastReviewed: "2026-08-15",
  evaluate(profile, snapshot) {
    const t = THRESHOLDS.FORM_8938[profile.filingStatus];
    const { maxMinor, currentMinor } = maxForeignAggregateUsd(snapshot);
    const overAnyTime = maxMinor > t.anyTimeUsd;
    const nearYearEnd = currentMinor > t.yearEndUsd;
    if (!overAnyTime && !nearYearEnd) return [];
    return [
      {
        ruleKey: "FORM_8938",
        severity: "warning",
        kind: "compliance",
        entityRef: "",
        title: "Form 8938 threshold status",
        message: overAnyTime
          ? `Foreign financial assets peaked at ${formatMinorUnits(maxMinor, "USD")} — over the ${formatMinorUnits(t.anyTimeUsd, "USD")} any-time threshold for your filing status. Form 8938 applies this year.`
          : `Current foreign assets ${formatMinorUnits(currentMinor, "USD")} exceed the ${formatMinorUnits(t.yearEndUsd, "USD")} year-end threshold — if this holds to Dec 31, Form 8938 applies.`,
        action: "Add Form 8938 to this year's US return prep. Thresholds differ by filing status — confirm yours in Settings.",
        citation: "26 CFR 1.6038D-2",
        valueMinor: maxMinor,
        valueCurrency: "USD",
      },
    ];
  },
};
