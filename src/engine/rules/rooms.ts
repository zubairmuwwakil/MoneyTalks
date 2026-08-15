import { formatMinorUnits } from "../money";
import { THRESHOLDS } from "./thresholds";
import type { FinancialSnapshot, Rule, RuleAlert } from "./types";
import { txsThisYear } from "./types";

function contributionsThisYear(snapshot: FinancialSnapshot, accountType: string): number {
  return snapshot.accounts
    .filter((a) => a.type === accountType)
    .flatMap((a) => txsThisYear(a, snapshot.today, "CONTRIBUTION"))
    .reduce((sum, t) => sum + t.amountMinor, 0);
}

function roomAlert(
  key: string,
  label: string,
  roomJan1: number,
  contributed: number,
  citation: string,
  extraAction = "",
): RuleAlert[] {
  if (roomJan1 <= 0) return []; // no CRA figure entered — nothing to guard
  const remaining = roomJan1 - contributed;
  if (remaining >= 0) {
    return [
      {
        ruleKey: key,
        severity: "info",
        kind: "opportunity",
        entityRef: "",
        title: `${label}: ${formatMinorUnits(remaining, "CAD")} of room left`,
        message: `Room entered for Jan 1 minus ${formatMinorUnits(contributed, "CAD")} contributed this year leaves ${formatMinorUnits(remaining, "CAD")}.`,
        action: `Contribute up to ${formatMinorUnits(remaining, "CAD")} without penalty. ${extraAction}`.trim(),
        citation,
        valueMinor: remaining,
        valueCurrency: "CAD",
      },
    ];
  }
  return [
    {
      ruleKey: key,
      severity: "critical",
      kind: "compliance",
      entityRef: "",
      title: `${label}: OVER-CONTRIBUTED by ${formatMinorUnits(-remaining, "CAD")}`,
      message: `Contributions this year exceed your entered room. Over-contributions are penalized at ${THRESHOLDS.OVERCONTRIBUTION_PENALTY_PCT_PER_MONTH}%/month on the excess until withdrawn.`,
      action: "Verify your current room on CRA MyAccount (it may be stale in Settings). If truly over, withdraw the excess now.",
      citation,
      valueMinor: -remaining,
      valueCurrency: "CAD",
    },
  ];
}

export const tfsaRoomRule: Rule = {
  key: "TFSA_ROOM",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "ITA s.207.02 — TFSA over-contribution tax",
  lastReviewed: "2026-08-15",
  evaluate(profile, snapshot) {
    return roomAlert(
      "TFSA_ROOM",
      "TFSA",
      profile.tfsaRoomMinor,
      contributionsThisYear(snapshot, "TFSA"),
      "ITA s.207.02",
      "Note: for US persons TFSA growth is still US-taxable (see the TFSA reality alert).",
    );
  },
};

export const rrspRoomRule: Rule = {
  key: "RRSP_ROOM",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "ITA s.204.1 — RRSP over-contribution tax ($2,000 grace not modeled)",
  lastReviewed: "2026-08-15",
  evaluate(profile, snapshot) {
    return roomAlert(
      "RRSP_ROOM",
      "RRSP",
      profile.rrspRoomMinor,
      contributionsThisYear(snapshot, "RRSP"),
      "ITA s.204.1",
      "Deduction limit from your latest Notice of Assessment; contributions in the first 60 days of next year also count for this year.",
    );
  },
};

export const fhsaRoomRule: Rule = {
  key: "FHSA_ROOM",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "ITA s.146.6 — FHSA: $8,000/yr, $40,000 lifetime",
  lastReviewed: "2026-08-15",
  evaluate(profile, snapshot) {
    const contributed = contributionsThisYear(snapshot, "FHSA");
    const alerts = roomAlert("FHSA_ROOM", "FHSA", profile.fhsaRoomMinor, contributed, "ITA s.146.6");
    if (contributed > THRESHOLDS.FHSA.ANNUAL_CAP) {
      alerts.push({
        ruleKey: "FHSA_ROOM",
        severity: "critical",
        kind: "compliance",
        entityRef: "annual-cap",
        title: `FHSA annual cap exceeded`,
        message: `${formatMinorUnits(contributed, "CAD")} contributed this year exceeds the ${formatMinorUnits(THRESHOLDS.FHSA.ANNUAL_CAP, "CAD")} annual FHSA limit (carry-forward of up to ${formatMinorUnits(THRESHOLDS.FHSA.ANNUAL_CAP, "CAD")} can raise your personal limit — verify).`,
        action: "Check your FHSA participation room on CRA MyAccount; withdraw any true excess.",
        citation: "ITA s.146.6",
      });
    }
    return alerts;
  },
};

export const rdspLifetimeRule: Rule = {
  key: "RDSP_LIFETIME",
  jurisdiction: "CA",
  kind: "compliance",
  citation: "Canada Disability Savings Act — $200,000 lifetime contribution limit",
  lastReviewed: "2026-08-15",
  evaluate(profile, snapshot) {
    const total = profile.rdspContribLifetimeMinor + contributionsThisYear(snapshot, "RDSP");
    if (total <= THRESHOLDS.CDSG.LIFETIME_CONTRIB_MAX) return [];
    return [
      {
        ruleKey: "RDSP_LIFETIME",
        severity: "critical",
        kind: "compliance",
        entityRef: "",
        title: "RDSP lifetime contribution limit exceeded",
        message: `Lifetime contributions ≈ ${formatMinorUnits(total, "CAD")}, over the ${formatMinorUnits(THRESHOLDS.CDSG.LIFETIME_CONTRIB_MAX, "CAD")} cap.`,
        action: "Verify lifetime totals with ESDC/your issuer before contributing more.",
        citation: "Canada Disability Savings Act",
      },
    ];
  },
};

export const staleDataRule: Rule = {
  key: "STALE_DATA",
  jurisdiction: "CROSS",
  kind: "compliance",
  citation: "Internal data-freshness policy (30 days)",
  lastReviewed: "2026-08-15",
  evaluate(_profile, snapshot) {
    const cutoff = new Date(snapshot.today).getTime() - THRESHOLDS.STALE_DATA_DAYS * 86_400_000;
    const stalePrices = snapshot.accounts
      .flatMap((a) => a.holdings)
      .filter((h) => new Date(h.priceAsOf).getTime() < cutoff).length;
    const staleFx = snapshot.fxRates.filter((r) => new Date(r.asOf).getTime() < cutoff).length;
    if (stalePrices === 0 && staleFx === 0) return [];
    return [
      {
        ruleKey: "STALE_DATA",
        severity: "info",
        kind: "compliance",
        entityRef: "",
        title: "Stale prices or FX rates",
        message: `${stalePrices} holding price(s) and ${staleFx} FX rate(s) are older than ${THRESHOLDS.STALE_DATA_DAYS} days — net worth, FBAR aggregates, and thresholds silently rot on stale inputs.`,
        action: "Update holding prices on their account pages and refresh FX via import.",
        citation: "Internal policy",
      },
    ];
  },
};
