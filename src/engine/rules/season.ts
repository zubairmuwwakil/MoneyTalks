import type { Rule } from "./types";

// Canadian personal returns are due April 30; US persons abroad get an automatic
// extension to June 15, with FBAR (FinCEN 114) on an automatic extension to Oct 15.
// The nudge runs January through April — the window where gathering slips actually
// changes the outcome. Verified 2026-08-15 at canada.ca and irs.gov.
const SEASON_MONTHS = new Set(["01", "02", "03", "04"]);

export const taxSeasonRule: Rule = {
  key: "TAX_SEASON",
  jurisdiction: "CROSS",
  kind: "opportunity",
  citation: "CRA filing deadline April 30; IRS automatic extension to June 15 for US persons abroad",
  lastReviewed: "2026-08-15",
  evaluate(_profile, snapshot) {
    if (!SEASON_MONTHS.has(snapshot.today.slice(5, 7))) return [];
    return [
      {
        ruleKey: "TAX_SEASON",
        severity: "info",
        kind: "opportunity",
        entityRef: "",
        title: "Tax season: your checklist is ready",
        message:
          "It is filing season. The checklist works out which forms your own data suggests you need — FBAR, 8938, 8621, T1135 — and which credits are worth gathering slips for, each with the figure behind it.",
        action: "Open the tax checklist at /money-finder/tax and work down it. It flags what is likely required; it never files anything.",
        citation: "CRA April 30 deadline; IRS June 15 for US persons abroad",
      },
    ];
  },
};
