import type { WriteOffItem } from "./writeOffSummary";

export interface ItcProvinceRate {
  provinceCode: string;
  name: string;
  itcRatePct: number; // Only recoverable GST/HST portion
  rateLabel: string;
}

export const PROVINCE_ITC_RATES: Record<string, ItcProvinceRate> = {
  ON: { provinceCode: "ON", name: "Ontario", itcRatePct: 13, rateLabel: "13% HST" },
  BC: { provinceCode: "BC", name: "British Columbia", itcRatePct: 5, rateLabel: "5% GST" }, // PST is not an ITC
  QC: { provinceCode: "QC", name: "Quebec", itcRatePct: 14.975, rateLabel: "5% GST + 9.975% QST" },
  AB: { provinceCode: "AB", name: "Alberta", itcRatePct: 5, rateLabel: "5% GST" },
  ATL: { provinceCode: "ATL", name: "Atlantic Canada (NB/NL/NS/PE)", itcRatePct: 15, rateLabel: "15% HST" },
  SK: { provinceCode: "SK", name: "Saskatchewan", itcRatePct: 5, rateLabel: "5% GST" },
  MB: { provinceCode: "MB", name: "Manitoba", itcRatePct: 5, rateLabel: "5% GST" },
};

export interface ItcCalculationResult {
  isRegistered: boolean;
  provinceCode: string;
  provinceLabel: string;
  itcRatePct: number;
  totalEligibleExpensesMinor: number;
  totalItcRefundMinor: number;
  craForm: string;
  craLine: string;
  explanation: string;
}

/**
 * Calculates the recoverable GST/HST Input Tax Credits (ITCs) on Form T2125 business expenses.
 * Mapped to CRA Form GST34 (GST/HST Return) Line 108.
 */
export function calculateItcRefund({
  items,
  provinceCode = "ON",
  isRegistered = true,
}: {
  items: WriteOffItem[];
  provinceCode?: string;
  isRegistered?: boolean;
}): ItcCalculationResult {
  const rateDef = PROVINCE_ITC_RATES[provinceCode.toUpperCase()] ?? PROVINCE_ITC_RATES.ON;

  if (!isRegistered) {
    return {
      isRegistered: false,
      provinceCode: rateDef.provinceCode,
      provinceLabel: rateDef.name,
      itcRatePct: rateDef.itcRatePct,
      totalEligibleExpensesMinor: 0,
      totalItcRefundMinor: 0,
      craForm: "GST34",
      craLine: "108",
      explanation: "GST/HST registration is not enabled. Registered businesses with >$30k revenue can claim Line 108 ITCs.",
    };
  }

  // Only T2125 business expenses are eligible for business ITCs (personal medical/donations are not)
  const businessItems = items.filter((i) => i.form === "T2125");
  let totalEligibleExpensesMinor = 0;
  let totalItcRefundMinor = 0;

  const rate = rateDef.itcRatePct / 100;

  for (const item of businessItems) {
    const claimedMinor = item.claimedAmountMinor;
    totalEligibleExpensesMinor += claimedMinor;

    // In Canada, receipt totals are tax-inclusive: Tax = Total * (Rate / (1 + Rate))
    const embeddedTaxMinor = Math.round(claimedMinor * (rate / (1 + rate)));
    totalItcRefundMinor += embeddedTaxMinor;
  }

  return {
    isRegistered: true,
    provinceCode: rateDef.provinceCode,
    provinceLabel: rateDef.name,
    itcRatePct: rateDef.itcRatePct,
    totalEligibleExpensesMinor,
    totalItcRefundMinor,
    craForm: "GST34",
    craLine: "108",
    explanation: `Calculated from ${businessItems.length} Form T2125 business expense items at ${rateDef.rateLabel}. Enter this figure directly on CRA Form GST34 Line 108 for your sales tax refund.`,
  };
}
