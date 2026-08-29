import { describe, expect, it } from "vitest";
import { generateWriteOffsCsv, summarizeWriteOffs, type WriteOffItem } from "./writeOffSummary";

describe("writeOffSummary", () => {
  const sampleItems: WriteOffItem[] = [
    {
      id: "item-1",
      date: "2026-03-15",
      source: "PURCHASE",
      merchant: "Anthropic Claude Pro",
      grossAmountMinor: 2800, // $28.00
      currency: "CAD",
      form: "T2125",
      line: "8810",
      lineName: "Office & Software Subscriptions",
      businessPct: 100,
      claimedAmountMinor: 2800,
      hasReceiptProof: true,
      notes: "AI subscription",
    },
    {
      id: "item-2",
      date: "2026-03-10",
      source: "BILL",
      merchant: "Rogers Wireless",
      grossAmountMinor: 10000, // $100.00
      currency: "CAD",
      form: "T2125",
      line: "9281",
      lineName: "Telephone & Utilities",
      businessPct: 50,
      claimedAmountMinor: 5000, // 50% = $50.00
      hasReceiptProof: false,
      notes: "Cell phone 50% business",
    },
    {
      id: "item-3",
      date: "2026-02-20",
      source: "PURCHASE",
      merchant: "Shoppers Drug Mart Rx",
      grossAmountMinor: 6500, // $65.00
      currency: "CAD",
      form: "PERSONAL_T1",
      line: "33099",
      lineName: "Eligible Medical Expenses",
      businessPct: 100,
      claimedAmountMinor: 6500,
      hasReceiptProof: true,
      notes: "Prescription",
    },
  ];

  it("calculates correct totals and estimated tax savings", () => {
    const summary = summarizeWriteOffs({
      items: sampleItems,
      taxYear: "2026",
      marginalRatePct: 30,
    });

    expect(summary.taxYear).toBe("2026");
    expect(summary.totalGrossMinor).toBe(19300); // $193.00
    expect(summary.totalClaimedMinor).toBe(14300); // $28 + $50 + $65 = $143.00
    expect(summary.estimatedTaxSavingsMinor).toBe(4290); // 30% of $143.00 = $42.90
    expect(summary.receiptProofCount).toBe(2);
    expect(summary.receiptCoveragePct).toBe(67); // 2/3 = 67%
  });

  it("breaks down subtotals by CRA Form and Line", () => {
    const summary = summarizeWriteOffs({
      items: sampleItems,
      taxYear: "2026",
    });

    expect(summary.byForm.T2125.totalClaimedMinor).toBe(7800); // $28 + $50 = $78.00
    expect(summary.byForm.PERSONAL_T1.totalClaimedMinor).toBe(6500); // $65.00
    expect(summary.byForm.T777.totalClaimedMinor).toBe(0);

    expect(summary.byLine.length).toBe(3);
    expect(summary.byLine[0].line).toBe("33099");
    expect(summary.byLine[0].totalClaimedMinor).toBe(6500);
  });

  it("generates valid CSV formatted output", () => {
    const summary = summarizeWriteOffs({
      items: sampleItems,
      taxYear: "2026",
    });

    const csv = generateWriteOffsCsv(summary);
    expect(csv).toContain('"Date","Merchant / Payee","CRA Form"');
    expect(csv).toContain('"Anthropic Claude Pro"');
    expect(csv).toContain('"T2125"');
    expect(csv).toContain("28.00");
    expect(csv).toContain("YES");
  });
});
