// All amounts are integer minor units (cents) unless noted.
// Each entry cites its source. Program parameters change annually —
// alerts phrase these as "approximately/up to" and tell the user what to verify.
//
// VERIFIED 2026-08-15 against the cited primary sources. Values marked (2026)
// are indexed annually and must be re-checked each January; the RULES_STALE
// alert fires automatically once a rule's lastReviewed passes 365 days.

export const THRESHOLDS = {
  // FinCEN Form 114 (FBAR): 31 CFR 1010.350 — "aggregate value ... exceeded $10,000
  // at any time during the calendar year". Verified 2026-08-15 at irs.gov.
  FBAR_AGGREGATE_USD: 10_000_00,

  // IRS Form 8938 (FATCA): 26 CFR 1.6038D-2. Verified 2026-08-15 at irs.gov
  // ("Summary of FATCA reporting for U.S. taxpayers"). Not indexed.
  FORM_8938: {
    SINGLE_ABROAD: { yearEndUsd: 200_000_00, anyTimeUsd: 300_000_00 },
    MFJ_ABROAD: { yearEndUsd: 400_000_00, anyTimeUsd: 600_000_00 },
    OTHER: { yearEndUsd: 50_000_00, anyTimeUsd: 75_000_00 }, // US-resident unmarried baseline
  },

  // PFIC heuristic: Canadian-listed fund suffixes (Form 8621, IRC §1291-1298).
  // .TO = TSX, .V = TSX Venture, .NE = Cboe Canada (formerly NEO Exchange).
  PFIC_TICKER_SUFFIXES: [".TO", ".V", ".NE"],

  // US–Canada treaty Art. X caps withholding on portfolio dividends at 15%; the
  // treaty's pension article does NOT cover TFSAs, so the credit is unrecoverable
  // inside one. Verified 2026-08-15 (IRS Publication 597).
  TFSA_US_DIVIDEND_WITHHOLDING_PCT: 15,

  // CRA T1135: cost of specified foreign property > CAD $100,000 at any time in the
  // year (ITA s.233.3). Detailed Part B reporting starts at $250,000. Not indexed.
  // Verified 2026-08-15 at canada.ca.
  T1135_COST_CAD: 100_000_00,

  // Canada Disability Savings Grant (CDSG), Canada Disability Savings Act / ESDC.
  // Verified 2026-08-15 at canada.ca ("How much you could get in grants and bonds").
  // At or below the second income threshold: 300% on the first $500, 200% on the next $1,000
  // (max $3,500/yr on a $1,500 contribution). Above it: 100% on the first $1,000.
  CDSG: {
    LOW_BANDS: [
      { matchRate: 3, contributionCap: 500_00 },
      { matchRate: 2, contributionCap: 1_000_00 },
    ],
    HIGH_BANDS: [{ matchRate: 1, contributionCap: 1_000_00 }],
    ANNUAL_MAX_WITH_CARRYFORWARD: 10_500_00, // "The matching grant is subject to a $10,500 annual limit"
    LIFETIME_GRANT_MAX: 70_000_00,
    LIFETIME_CONTRIB_MAX: 200_000_00,
    // ESDC Notice #577 (2026 income matching rates): the "second threshold" is $117,045
    // for 2026, tested on adjusted family net income from 2 tax years prior (2024 return).
    INCOME_THRESHOLD_NOTE:
      "The 300%/200% tiers apply at or below $117,045 adjusted family net income for 2026 (ESDC Notice #577), tested on your 2024 return — verify your tier at canada.ca",
  },

  // Canada Disability Savings Bond (CDSB): up to $1,000/yr, no contribution required.
  // Income-tested — full bond at or below $38,237 (2026), nil at or above $58,523 (2026).
  // Verified 2026-08-15 (ESDC Notice #577 + canada.ca).
  CDSB: { ANNUAL_MAX: 1_000_00, LIFETIME_MAX: 20_000_00 },

  // FHSA: ITA s.146.6 — $8,000 annual participation room, $40,000 lifetime. Unused room
  // carries forward to a maximum of $8,000, so a personal annual limit can reach $16,000.
  // Verified 2026-08-15 at canada.ca.
  FHSA: { ANNUAL_CAP: 8_000_00, LIFETIME_CAP: 40_000_00 },

  // TFSA/FHSA/RRSP excess: 1%/month on the excess (ITA s.207.02 / s.207.021 / s.204.1).
  // TFSA has no grace amount; RRSP has a $2,000 cushion (not modeled). Verified 2026-08-15.
  OVERCONTRIBUTION_PENALTY_PCT_PER_MONTH: 1,

  // Disability amount (line 31600) — $10,341 for 2026, indexed annually.
  // Verified 2026-08-15 (CRA "Indexation adjustment for personal income tax and benefit amounts").
  DTC_FEDERAL_AMOUNT: 10_341_00,

  // Non-refundable credits are valued at the lowest federal personal income tax rate,
  // which dropped to 14% for 2026 and later years. Verified 2026-08-15 at canada.ca.
  FEDERAL_CREDIT_RATE_PCT: 14,

  // Canada Workers Benefit, single with no children — 2026 figures, indexed annually.
  // Verified 2026-08-15 (CRA indexation table). The basic amount phases out at 15% of
  // adjusted net income above PHASE_OUT_START_SINGLE, so it reaches nil at
  // $27,392 + ($1,665 / 0.15) = $38,492.
  CWB: {
    MIN_WORKING_INCOME: 3_000_00,
    PHASE_OUT_START_SINGLE: 27_392_00,
    NET_INCOME_CUTOFF_SINGLE: 38_492_00,
    MAX_SINGLE: 1_665_00,
  },

  // Canada Employment Amount (line 31260) — $1,501 for 2026, indexed annually.
  // Verified 2026-08-15 (CRA indexation table).
  CANADA_EMPLOYMENT_AMOUNT: 1_501_00,

  // Ontario Works (OW) / ODSP — earnings exemptions and asset limits.
  // Verified 2026-08-15 at ontario.ca (OW directives 4.2 + 5.3, ODSP directives 4.1 + 5.3).
  // OW: first $200/mo of net earnings exempt, then 50% of the remainder is deducted.
  // ODSP: first $1,000/mo exempt, then 75% of the remainder is deducted.
  // Neither exemption applies during the first 3 months of assistance.
  ONTARIO_SUPPORT: {
    OW: { MONTHLY_EARNINGS_EXEMPT: 200_00, CLAWBACK_PCT: 50, ASSET_LIMIT_SINGLE: 10_000_00 },
    ODSP: { MONTHLY_EARNINGS_EXEMPT: 1_000_00, CLAWBACK_PCT: 75, ASSET_LIMIT_SINGLE: 40_000_00 },
    // Asset treatment: RDSP funds are exempt for both; principal residence exempt; one
    // vehicle exempt; locked-in RRSPs/pensions exempt. TFSA/cash/non-registered count.
  },

  // Jamaica NHT: contributions are held 7 years and become refundable in the 8th year
  // after the contribution year. Verified 2026-08-15 at nht.gov.jm.
  NHT_REFUND_WAIT_YEARS: 7,

  STALE_DATA_DAYS: 30,
  RULE_REVIEW_STALE_DAYS: 365,
} as const;
