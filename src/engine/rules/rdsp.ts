import { formatMinorUnits } from "../money";
import { THRESHOLDS } from "./thresholds";
import type { ProfileView, Rule } from "./types";
import { txsThisYear } from "./types";

export interface CdsgPlanResult {
  optimalContributionMinor: number;
  grantAtOptimalMinor: number;
  additionalGrantMinor: number;
  effectiveMatchPct: number;
}

export function cdsgPlan(profile: ProfileView, contributedThisYearMinor: number): CdsgPlanResult {
  const bands =
    profile.rdspIncomeTier === "LOW" ? THRESHOLDS.CDSG.LOW_BANDS : THRESHOLDS.CDSG.HIGH_BANDS;
  const years = 1 + Math.max(0, profile.rdspCarryForwardYears);

  const grantRoom = Math.min(
    THRESHOLDS.CDSG.ANNUAL_MAX_WITH_CARRYFORWARD,
    Math.max(0, THRESHOLDS.CDSG.LIFETIME_GRANT_MAX - profile.rdspGrantsLifetimeMinor),
  );
  const contribRoom = Math.max(
    0,
    THRESHOLDS.CDSG.LIFETIME_CONTRIB_MAX - profile.rdspContribLifetimeMinor - contributedThisYearMinor,
  );

  // Walk bands highest-rate-first (they are declared in that order), greedily buying grant.
  let grant = 0;
  let contribution = 0;
  for (const band of bands) {
    const bandCap = band.contributionCap * years;
    if (grant >= grantRoom || contribution >= contribRoom) break;
    const grantLeft = grantRoom - grant;
    const contribLeft = contribRoom - contribution;
    const take = Math.min(bandCap, contribLeft, Math.floor(grantLeft / band.matchRate));
    contribution += take;
    grant += take * band.matchRate;
  }

  const grantOnCurrent = (() => {
    let g = 0;
    let c = contributedThisYearMinor;
    for (const band of bands) {
      const bandCap = band.contributionCap * years;
      const used = Math.min(bandCap, c);
      g += used * band.matchRate;
      c -= used;
      if (c <= 0) break;
    }
    return Math.min(g, grantRoom);
  })();

  return {
    optimalContributionMinor: contribution,
    grantAtOptimalMinor: grant,
    additionalGrantMinor: Math.max(0, grant - grantOnCurrent),
    effectiveMatchPct: contribution > 0 ? Math.round((grant / contribution) * 100) : 0,
  };
}

export const cdsgRule: Rule = {
  key: "RDSP_CDSG",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "Canada Disability Savings Act; ESDC CDSG matching tiers",
  lastReviewed: "2026-08-15",
  evaluate(profile, snapshot) {
    const rdspAccounts = snapshot.accounts.filter((a) => a.type === "RDSP");
    if (rdspAccounts.length === 0) {
      if (!profile.dtcEligible) return [];
      return [
        {
          ruleKey: "RDSP_CDSG",
          severity: "warning",
          kind: "opportunity",
          entityRef: "",
          title: "DTC-eligible with no RDSP on file",
          message: "You are marked DTC-eligible but no RDSP account exists here. The CDSG matches contributions at up to 300% — the highest-ROI dollar available anywhere.",
          action: "Open an RDSP (or add your existing one under Investments), then this optimizer computes your exact contribution.",
          citation: "Canada Disability Savings Act",
        },
      ];
    }

    const contributed = rdspAccounts
      .flatMap((a) => txsThisYear(a, snapshot.today, "CONTRIBUTION"))
      .reduce((sum, t) => sum + t.amountMinor, 0);
    const plan = cdsgPlan(profile, contributed);
    if (plan.additionalGrantMinor <= 0) return [];

    const tierNote =
      profile.rdspIncomeTier === "UNKNOWN"
        ? " (income tier UNKNOWN — treated as the lower 100% match; set your tier in Settings, the real number may be much higher)"
        : "";
    const remainingContribution = plan.optimalContributionMinor - contributed;

    return [
      {
        ruleKey: "RDSP_CDSG",
        severity: "warning",
        kind: "opportunity",
        entityRef: "",
        title: `CDSG: ${formatMinorUnits(plan.additionalGrantMinor, "CAD")} in grants available this year`,
        message: `Contribute ${formatMinorUnits(Math.max(0, remainingContribution), "CAD")} more by Dec 31 to receive ${formatMinorUnits(plan.grantAtOptimalMinor, "CAD")} in CDSG — an effective ${plan.effectiveMatchPct}% match${tierNote}. ${THRESHOLDS.CDSG.INCOME_THRESHOLD_NOTE}.`,
        action: "This is the app's highest-ROI dollar: fund the RDSP before any other account. Verify your carry-forward entitlement on your ESDC Statement of Grant Entitlement.",
        citation: "Canada Disability Savings Act; ESDC",
        valueMinor: plan.additionalGrantMinor,
        valueCurrency: "CAD",
      },
    ];
  },
};

export const cdsbRule: Rule = {
  key: "RDSP_CDSB",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "Canada Disability Savings Act — CDSB pays without contributions, income-tested",
  lastReviewed: "2026-08-15",
  evaluate(profile, snapshot) {
    if (profile.rdspIncomeTier !== "LOW") return [];
    if (!snapshot.accounts.some((a) => a.type === "RDSP")) return [];
    return [
      {
        ruleKey: "RDSP_CDSB",
        severity: "info",
        kind: "opportunity",
        entityRef: "",
        title: `CDSB: up to ${formatMinorUnits(THRESHOLDS.CDSB.ANNUAL_MAX, "CAD")}/yr with zero contribution`,
        message: `At the low income tier the Canada Disability Savings Bond pays up to ${formatMinorUnits(THRESHOLDS.CDSB.ANNUAL_MAX, "CAD")}/yr into the RDSP without any contribution (lifetime cap ${formatMinorUnits(THRESHOLDS.CDSB.LIFETIME_MAX, "CAD")}; up to 10 years of carry-forward).`,
        action: "Nothing to deposit — just ensure the RDSP is open and your tax returns are filed (income testing uses them). Verify bond entitlement on your ESDC statement.",
        citation: "Canada Disability Savings Act",
        valueMinor: THRESHOLDS.CDSB.ANNUAL_MAX,
        valueCurrency: "CAD",
      },
    ];
  },
};
