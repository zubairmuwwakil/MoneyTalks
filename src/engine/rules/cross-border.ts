import { convertMinor } from "../fx";
import { formatMinorUnits } from "../money";
import { THRESHOLDS } from "./thresholds";
import type { Rule } from "./types";
import { txsThisYear } from "./types";

function isPficSuspect(symbol: string, domicileCountry: string): boolean {
  return (
    domicileCountry === "CA" ||
    THRESHOLDS.PFIC_TICKER_SUFFIXES.some((suffix) => symbol.toUpperCase().endsWith(suffix))
  );
}

export const pficRule: Rule = {
  key: "PFIC",
  jurisdiction: "US",
  kind: "compliance",
  citation: "IRC §1291–1298; IRS Form 8621",
  lastReviewed: "2026-08-15",
  evaluate(_profile, snapshot) {
    return snapshot.accounts
      .filter((a) => a.type !== "RRSP")
      .flatMap((account) =>
        account.holdings
          .filter((h) => isPficSuspect(h.symbol, h.domicileCountry))
          .map((h) => ({
            ruleKey: "PFIC",
            severity: "critical" as const,
            kind: "compliance" as const,
            entityRef: h.id,
            title: `PFIC risk: ${h.symbol} in ${account.name}`,
            message: `${h.symbol} (${h.name}) in ${account.name} looks like a Canadian-domiciled fund held outside an RRSP — a PFIC for US tax purposes, with punitive taxation and Form 8621 per fund, per year.`,
            action: "Documented fix: sell and replace with a US-listed equivalent, or move exposure inside the RRSP. Form 8621 applies for any year it was held. Verify with your cross-border accountant.",
            citation: "IRC §1291–1298; Form 8621",
          })),
      );
  },
};

export const rothFreezeRule: Rule = {
  key: "ROTH_FREEZE",
  jurisdiction: "CROSS",
  kind: "compliance",
  citation: "Canada–US Tax Treaty Art. XVIII(3.5); CRA Income Tax Folio S5-F3-C1",
  lastReviewed: "2026-08-15",
  evaluate(profile, snapshot) {
    if (profile.residency !== "CA") return [];
    return snapshot.accounts
      .filter((a) => a.type === "ROTH_IRA")
      .flatMap((account) =>
        account.transactions
          .filter((t) => t.type === "CONTRIBUTION")
          .map((t) => ({
            ruleKey: "ROTH_FREEZE",
            severity: "critical" as const,
            kind: "compliance" as const,
            entityRef: t.id,
            title: "Roth contribution logged while Canadian-resident",
            message: `A ${formatMinorUnits(t.amountMinor, "USD")} contribution to ${account.name} dated ${t.date.slice(0, 10)} is recorded. Contributions while resident in Canada create "Canadian contributions" that taint the treaty election — the Roth's tax-free status in Canada can be permanently lost.`,
            action: "If this is a data-entry error, delete the transaction. If it really happened, contact your cross-border accountant about remediation immediately.",
            citation: "Treaty Art. XVIII(3.5); CRA Folio S5-F3-C1",
          })),
      );
  },
};

export const tfsaDragRule: Rule = {
  key: "TFSA_US_DRAG",
  jurisdiction: "CROSS",
  kind: "compliance",
  citation: "TFSAs are not covered by the treaty's pension article; growth is US-taxable for US persons",
  lastReviewed: "2026-08-15",
  evaluate(profile, snapshot) {
    if (!profile.citizenships.includes("US")) return [];
    return snapshot.accounts
      .filter((a) => a.type === "TFSA")
      .map((account) => {
        const incomeThisYear = txsThisYear(account, snapshot.today)
          .filter((t) => t.type === "DIVIDEND" || t.type === "INTEREST")
          .reduce((sum, t) => sum + t.amountMinor, 0);
        const drag = Math.round((incomeThisYear * profile.marginalUSRatePct) / 100);
        return {
          ruleKey: "TFSA_US_DRAG",
          severity: "info" as const,
          kind: "compliance" as const,
          entityRef: account.id,
          title: `${account.name}: growth is US-taxable`,
          message: `For a US person this account is NOT sheltered — the IRS taxes its growth annually. Logged income this year: ${formatMinorUnits(incomeThisYear, account.currency)}; estimated US tax drag at your ${profile.marginalUSRatePct}% marginal rate: ${formatMinorUnits(drag, account.currency)}.`,
          action: "Include this account's income on your US return. Consider whether RRSP or non-registered placement beats it after US tax.",
          citation: "US–Canada treaty scope; IRS treatment of TFSAs",
          valueMinor: drag,
          valueCurrency: account.currency,
        };
      });
  },
};

export const tfsaWithholdingRule: Rule = {
  key: "TFSA_US_WITHHOLDING",
  jurisdiction: "CROSS",
  kind: "compliance",
  citation: "US–Canada Tax Treaty Art. X — 15% withholding not recoverable inside a TFSA",
  lastReviewed: "2026-08-15",
  evaluate(_profile, snapshot) {
    return snapshot.accounts
      .filter((a) => a.type === "TFSA")
      .flatMap((account) =>
        account.holdings
          .filter((h) => h.domicileCountry === "US")
          .map((h) => ({
            ruleKey: "TFSA_US_WITHHOLDING",
            severity: "info" as const,
            kind: "compliance" as const,
            entityRef: h.id,
            title: `${h.symbol} in ${account.name}: 15% dividend withholding`,
            message: `US dividends inside a TFSA suffer ${THRESHOLDS.TFSA_US_DIVIDEND_WITHHOLDING_PCT}% withholding that can never be recovered (no foreign tax credit applies inside a TFSA).`,
            action: "US dividend payers are usually better placed in an RRSP (treaty-exempt) or non-registered (credit available).",
            citation: "Treaty Art. X",
          })),
      );
  },
};

export const t1135Rule: Rule = {
  key: "T1135",
  jurisdiction: "CA",
  kind: "compliance",
  citation: "ITA s.233.3 — Form T1135 for specified foreign property with cost > CAD $100,000",
  lastReviewed: "2026-08-15",
  evaluate(_profile, snapshot) {
    const NON_REGISTERED_TYPES = new Set(["NON_REGISTERED", "CRYPTO"]);
    let costCad = 0;
    for (const account of snapshot.accounts) {
      if (!NON_REGISTERED_TYPES.has(account.type)) continue;
      for (const h of account.holdings) {
        if (h.domicileCountry === "CA") continue;
        const cost = h.bookCostMinor ?? Math.round(h.quantity * h.lastPriceMinor);
        costCad += convertMinor(cost, account.currency, "CAD", snapshot.fxRates);
      }
    }
    if (costCad <= THRESHOLDS.T1135_COST_CAD) return [];
    return [
      {
        ruleKey: "T1135",
        severity: "warning",
        kind: "compliance",
        entityRef: "",
        title: "T1135 filing likely required",
        message: `Cost of foreign property in non-registered accounts ≈ ${formatMinorUnits(costCad, "CAD")}, over the CAD $100,000 threshold. (Heuristic: non-CA-domiciled holdings incl. crypto — classification nuances exist.)`,
        action: "Confirm T1135 scope with your accountant before the filing deadline — penalties for missing it are steep.",
        citation: "ITA s.233.3",
        valueMinor: costCad,
        valueCurrency: "CAD",
      },
    ];
  },
};
