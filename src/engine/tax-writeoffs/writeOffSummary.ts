import type { Currency } from "../money";
import type { CraFormType } from "./craTaxLines";

export interface WriteOffItem {
  id: string;
  date: string;
  source: "PURCHASE" | "BILL" | "TRANSACTION";
  merchant: string;
  grossAmountMinor: number;
  currency: Currency;
  form: CraFormType;
  line: string;
  lineName: string;
  businessPct: number;
  claimedAmountMinor: number;
  hasReceiptProof: boolean;
  notes: string | null;
}

export interface FormSubtotal {
  form: CraFormType;
  formLabel: string;
  totalGrossMinor: number;
  totalClaimedMinor: number;
  itemCount: number;
}

export interface LineSubtotal {
  form: CraFormType;
  line: string;
  lineName: string;
  totalGrossMinor: number;
  totalClaimedMinor: number;
  itemCount: number;
}

export interface WriteOffSummaryResult {
  taxYear: string;
  totalGrossMinor: number;
  totalClaimedMinor: number;
  estimatedTaxSavingsMinor: number;
  effectiveMarginalRatePct: number;
  receiptProofCount: number;
  totalItemCount: number;
  receiptCoveragePct: number;
  byForm: Record<CraFormType, FormSubtotal>;
  byLine: LineSubtotal[];
  items: WriteOffItem[];
}

const FORM_LABELS: Record<CraFormType, string> = {
  T2125: "Form T2125 (Self-Employed / Business)",
  T777: "Form T777 (Remote Work / Employment)",
  PERSONAL_T1: "Personal T1 (Medical, Donations, Dues)",
};

/**
 * Aggregates a list of write-off candidates and claims into an audit-ready summary.
 * Estimates tax savings based on the user's marginal rate (defaults to 30%).
 */
export function summarizeWriteOffs({
  items,
  taxYear,
  marginalRatePct = 30,
}: {
  items: WriteOffItem[];
  taxYear: string;
  marginalRatePct?: number;
}): WriteOffSummaryResult {
  let totalGrossMinor = 0;
  let totalClaimedMinor = 0;
  let receiptProofCount = 0;

  const byForm: Record<CraFormType, FormSubtotal> = {
    T2125: { form: "T2125", formLabel: FORM_LABELS.T2125, totalGrossMinor: 0, totalClaimedMinor: 0, itemCount: 0 },
    T777: { form: "T777", formLabel: FORM_LABELS.T777, totalGrossMinor: 0, totalClaimedMinor: 0, itemCount: 0 },
    PERSONAL_T1: {
      form: "PERSONAL_T1",
      formLabel: FORM_LABELS.PERSONAL_T1,
      totalGrossMinor: 0,
      totalClaimedMinor: 0,
      itemCount: 0,
    },
  };

  const lineMap = new Map<string, LineSubtotal>();

  for (const item of items) {
    totalGrossMinor += item.grossAmountMinor;
    totalClaimedMinor += item.claimedAmountMinor;
    if (item.hasReceiptProof) {
      receiptProofCount++;
    }

    // Form breakdown
    const formGroup = byForm[item.form];
    if (formGroup) {
      formGroup.totalGrossMinor += item.grossAmountMinor;
      formGroup.totalClaimedMinor += item.claimedAmountMinor;
      formGroup.itemCount++;
    }

    // Line breakdown
    const lineKey = `${item.form}_${item.line}`;
    const existingLine = lineMap.get(lineKey);
    if (existingLine) {
      existingLine.totalGrossMinor += item.grossAmountMinor;
      existingLine.totalClaimedMinor += item.claimedAmountMinor;
      existingLine.itemCount++;
    } else {
      lineMap.set(lineKey, {
        form: item.form,
        line: item.line,
        lineName: item.lineName,
        totalGrossMinor: item.grossAmountMinor,
        totalClaimedMinor: item.claimedAmountMinor,
        itemCount: 1,
      });
    }
  }

  const estimatedTaxSavingsMinor = Math.round(totalClaimedMinor * (marginalRatePct / 100));
  const receiptCoveragePct = items.length > 0 ? Math.round((receiptProofCount / items.length) * 100) : 100;

  return {
    taxYear,
    totalGrossMinor,
    totalClaimedMinor,
    estimatedTaxSavingsMinor,
    effectiveMarginalRatePct: marginalRatePct,
    receiptProofCount,
    totalItemCount: items.length,
    receiptCoveragePct,
    byForm,
    byLine: Array.from(lineMap.values()).sort((a, b) => b.totalClaimedMinor - a.totalClaimedMinor),
    items: [...items].sort((a, b) => (a.date < b.date ? 1 : -1)),
  };
}

/**
 * Converts write-off items into an audit-ready CSV format for tax filing import.
 */
export function generateWriteOffsCsv(summary: WriteOffSummaryResult): string {
  const headers = [
    '"Date"',
    '"Merchant / Payee"',
    '"CRA Form"',
    '"CRA Line"',
    '"Line Description"',
    '"Gross Amount"',
    '"Currency"',
    '"Business Allocation %"',
    '"Claimed Deductible Amount"',
    '"Receipt Proof Attached"',
    '"Notes"',
  ];

  const rows = summary.items.map((i) => [
    `"${i.date}"`,
    `"${i.merchant.replace(/"/g, '""')}"`,
    `"${i.form}"`,
    `"${i.line}"`,
    `"${i.lineName.replace(/"/g, '""')}"`,
    (i.grossAmountMinor / 100).toFixed(2),
    `"${i.currency}"`,
    `${i.businessPct}%`,
    (i.claimedAmountMinor / 100).toFixed(2),
    i.hasReceiptProof ? "YES" : "NO",
    `"${(i.notes ?? "").replace(/"/g, '""')}"`,
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}
