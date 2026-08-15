import { convertMinor } from "../fx";
import { formatMinorUnits } from "../money";
import { THRESHOLDS } from "./thresholds";
import type { Rule, RuleAlert } from "./types";
import { annualizeMinor, monthlyMinor } from "./types";

export const dtcRule: Rule = {
  key: "DTC",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "ITA line 31600 — disability amount (federal; provincial amount additional)",
  lastReviewed: "2026-08-15",
  evaluate(profile) {
    if (!profile.dtcEligible) return [];
    const value = Math.round((THRESHOLDS.DTC_FEDERAL_AMOUNT * THRESHOLDS.FEDERAL_CREDIT_RATE_PCT) / 100);
    return [
      {
        ruleKey: "DTC",
        severity: "info",
        kind: "opportunity",
        entityRef: "",
        title: `Disability Tax Credit: ≈ ${formatMinorUnits(value, "CAD")} federal at tax time`,
        message: `The federal disability amount (~${formatMinorUnits(THRESHOLDS.DTC_FEDERAL_AMOUNT, "CAD")}, indexed annually) yields ≈ ${formatMinorUnits(value, "CAD")} at the ${THRESHOLDS.FEDERAL_CREDIT_RATE_PCT}% federal rate, plus the provincial amount. DTC eligibility is also what unlocks the RDSP.`,
        action: "Claim line 31600 on the T1. If a supporting family member has higher income, the credit can transfer — ask at tax time.",
        citation: "ITA line 31600",
        valueMinor: value,
        valueCurrency: "CAD",
      },
    ];
  },
};

export const cwbRule: Rule = {
  key: "CWB",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "ITA s.122.7 — Canada Workers Benefit (figures indexed annually; VERIFY at tax time)",
  lastReviewed: "2026-08-15",
  evaluate(profile) {
    const working = profile.incomeSources
      .filter((s) => s.kind === "EMPLOYMENT" || s.kind === "SELF_EMPLOYMENT")
      .reduce((sum, s) => sum + annualizeMinor(s), 0);
    const net = profile.incomeSources.reduce((sum, s) => sum + annualizeMinor(s), 0);
    if (working < THRESHOLDS.CWB.MIN_WORKING_INCOME || net >= THRESHOLDS.CWB.NET_INCOME_CUTOFF_SINGLE) {
      return [];
    }
    return [
      {
        ruleKey: "CWB",
        severity: "info",
        kind: "opportunity",
        entityRef: "",
        title: `Canada Workers Benefit: likely eligible, up to ${formatMinorUnits(THRESHOLDS.CWB.MAX_SINGLE, "CAD")}`,
        message: `Working income ≈ ${formatMinorUnits(working, "CAD")}/yr with net income under the ≈ ${formatMinorUnits(THRESHOLDS.CWB.NET_INCOME_CUTOFF_SINGLE, "CAD")} single cutoff suggests CWB eligibility of up to ${formatMinorUnits(THRESHOLDS.CWB.MAX_SINGLE, "CAD")} (the full amount phases out at 15% above ${formatMinorUnits(THRESHOLDS.CWB.PHASE_OUT_START_SINGLE, "CAD")}; a disability supplement may add more).`,
        action: "The CWB is claimed on Schedule 6 of the T1 — most tax software applies it automatically; just make sure you file.",
        citation: "ITA s.122.7",
        valueMinor: THRESHOLDS.CWB.MAX_SINGLE,
        valueCurrency: "CAD",
      },
    ];
  },
};

export const employmentAmountRule: Rule = {
  key: "CANADA_EMPLOYMENT_AMOUNT",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "ITA line 31260 — Canada Employment Amount (indexed annually)",
  lastReviewed: "2026-08-15",
  evaluate(profile) {
    const hasEmployment = profile.incomeSources.some((s) => s.kind === "EMPLOYMENT");
    if (!hasEmployment) return [];
    const value = Math.round(
      (THRESHOLDS.CANADA_EMPLOYMENT_AMOUNT * THRESHOLDS.FEDERAL_CREDIT_RATE_PCT) / 100,
    );
    return [
      {
        ruleKey: "CANADA_EMPLOYMENT_AMOUNT",
        severity: "info",
        kind: "opportunity",
        entityRef: "",
        title: `Canada Employment Amount: ≈ ${formatMinorUnits(value, "CAD")} at tax time`,
        message: `Employment income allows claiming up to ${formatMinorUnits(THRESHOLDS.CANADA_EMPLOYMENT_AMOUNT, "CAD")} (line 31260) — worth ≈ ${formatMinorUnits(value, "CAD")} federally. Not available for self-employment income.`,
        action: "Claimed automatically by most tax software; verify it appears on the return.",
        citation: "ITA line 31260",
        valueMinor: value,
        valueCurrency: "CAD",
      },
    ];
  },
};

// Ontario exempts RDSP funds and the principal residence for both programs; one vehicle and
// locked-in RRSPs/pensions are also exempt. Non-locked-in RRSPs are counted here as the
// conservative default — the alert tells the user to confirm treatment with their caseworker.
const OW_COUNTABLE_TYPES = new Set(["CASH", "CHEQUING", "TFSA", "NON_REGISTERED", "CRYPTO", "RRSP"]);
const ODSP_COUNTABLE_TYPES = new Set(["CASH", "CHEQUING", "TFSA", "NON_REGISTERED", "CRYPTO", "RRSP"]);

export const incomeSupportRule: Rule = {
  key: "INCOME_SUPPORT",
  jurisdiction: "CA",
  kind: "compliance",
  citation: "Ontario Works Act / ODSP Act regulations — earnings exemptions and asset limits (change frequently; VERIFY with caseworker)",
  lastReviewed: "2026-08-15",
  evaluate(profile, snapshot) {
    const program = profile.benefitPrograms.find((p) => p === "OW" || p === "ODSP");
    if (!program) return [];
    const params = THRESHOLDS.ONTARIO_SUPPORT[program as "OW" | "ODSP"];
    const countableTypes = program === "OW" ? OW_COUNTABLE_TYPES : ODSP_COUNTABLE_TYPES;
    const alerts: RuleAlert[] = [];

    const monthlyEarned = profile.incomeSources
      .filter((s) => s.kind === "EMPLOYMENT" || s.kind === "SELF_EMPLOYMENT")
      .reduce((sum, s) => sum + monthlyMinor(s), 0);
    if (monthlyEarned > 0) {
      const clawback = Math.max(
        0,
        Math.round(((monthlyEarned - params.MONTHLY_EARNINGS_EXEMPT) * params.CLAWBACK_PCT) / 100),
      );
      alerts.push({
        ruleKey: "INCOME_SUPPORT",
        severity: "info",
        kind: "compliance",
        entityRef: "earnings",
        title: `${program} earnings: ≈ ${formatMinorUnits(clawback, "CAD")}/mo clawback at current income`,
        message: `Earned income ≈ ${formatMinorUnits(monthlyEarned, "CAD")}/mo. ${program} exempts the first ${formatMinorUnits(params.MONTHLY_EARNINGS_EXEMPT, "CAD")}/mo, then reduces benefits by ${params.CLAWBACK_PCT}% of the rest — ≈ ${formatMinorUnits(clawback, "CAD")}/mo here. The exemption does not apply during the first 3 months of assistance.`,
        action: "Report earnings accurately and verify current exemption rules with your caseworker — figures change and individual circumstances vary.",
        citation: "Ontario Works / ODSP regulations",
        valueMinor: clawback,
        valueCurrency: "CAD",
      });
    }

    const countable = snapshot.accounts
      .filter((a) => countableTypes.has(a.type))
      .reduce((sum, a) => sum + convertMinor(a.balanceMinor, a.currency, "CAD", snapshot.fxRates), 0);
    const limit = params.ASSET_LIMIT_SINGLE;
    if (countable >= limit * 0.8) {
      alerts.push({
        ruleKey: "INCOME_SUPPORT",
        severity: countable >= limit ? "critical" : "warning",
        kind: "compliance",
        entityRef: "assets",
        title:
          countable >= limit
            ? `${program} asset limit exceeded`
            : `${program} assets at ${Math.round((countable / limit) * 100)}% of the limit`,
        message: `Countable assets ≈ ${formatMinorUnits(countable, "CAD")} vs the ${formatMinorUnits(limit, "CAD")} single-person limit (RDSP and principal residence are exempt and excluded here).`,
        action: "Verify countable-asset treatment with your caseworker. Note: RDSP contributions are exempt — moving eligible savings there can both earn CDSG and reduce countable assets. Verify before acting.",
        citation: "Ontario Works / ODSP regulations",
        valueMinor: countable,
        valueCurrency: "CAD",
      });
    }
    return alerts;
  },
};

export const nhtRule: Rule = {
  key: "NHT",
  jurisdiction: "JM",
  kind: "opportunity",
  citation: "Jamaica National Housing Trust — contributions refundable in the 8th year (nht.gov.jm)",
  lastReviewed: "2026-08-15",
  evaluate(profile) {
    if (!profile.citizenships.includes("JM") || !profile.nhtContributed) return [];
    return [
      {
        ruleKey: "NHT",
        severity: "info",
        kind: "opportunity",
        entityRef: "",
        title: "NHT contribution refund may be claimable",
        message: `NHT contributions become refundable in the 8th year after they were made (${THRESHOLDS.NHT_REFUND_WAIT_YEARS}-year wait). Refunds are not automatic — they must be claimed, and unclaimed refunds accumulate.`,
        action: "Check your contribution years and claim eligible refunds on the NHT online portal (nht.gov.jm).",
        citation: "nht.gov.jm",
      },
    ];
  },
};
