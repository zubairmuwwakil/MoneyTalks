import { describe, expect, it } from "vitest";
import { calculateItcRefund } from "./itcTracker";
import type { WriteOffItem } from "./writeOffSummary";

describe("itcTracker", () => {
  const sampleItems: WriteOffItem[] = [
    {
      id: "1",
      date: "2026-03-01",
      source: "PURCHASE",
      merchant: "Figma Subscription",
      grossAmountMinor: 11300, // $113.00 (tax-inclusive @ 13% ON HST = $100 base + $13 tax)
      currency: "CAD",
      form: "T2125",
      line: "8810",
      lineName: "Office & Software Subscriptions",
      businessPct: 100,
      claimedAmountMinor: 11300,
      hasReceiptProof: true,
      notes: null,
    },
    {
      id: "2",
      date: "2026-03-05",
      source: "PURCHASE",
      merchant: "Medical Dental Clinic",
      grossAmountMinor: 20000,
      currency: "CAD",
      form: "PERSONAL_T1",
      line: "33099",
      lineName: "Eligible Medical Expenses",
      businessPct: 100,
      claimedAmountMinor: 20000,
      hasReceiptProof: true,
      notes: null,
    },
  ];

  it("calculates Ontario 13% HST ITC refund on Form T2125 items only", () => {
    const result = calculateItcRefund({
      items: sampleItems,
      provinceCode: "ON",
      isRegistered: true,
    });

    expect(result.isRegistered).toBe(true);
    expect(result.craForm).toBe("GST34");
    expect(result.craLine).toBe("108");
    expect(result.totalEligibleExpensesMinor).toBe(11300); // Only T2125, not personal medical
    expect(result.totalItcRefundMinor).toBe(1300); // $13.00 exact tax refund
  });

  it("returns zero when user is not GST/HST registered", () => {
    const result = calculateItcRefund({
      items: sampleItems,
      provinceCode: "ON",
      isRegistered: false,
    });

    expect(result.isRegistered).toBe(false);
    expect(result.totalItcRefundMinor).toBe(0);
  });
});
