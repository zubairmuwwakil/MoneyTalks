import { it, expect } from "vitest";

import {
  classifyReceiptEmail,
  hasProspectiveChargeEvidence,
  hasPurchaseEvidence,
} from "./receiptEvidence";

// Subjects below are verbatim from the 100 messages the first real scan
// ingested — every one of them became a Purchase and a RETURN suggestion.
const OBSERVED_NEWSLETTERS = [
  "Trivium, Houndmouth, Greg Freeman & more!",
  "Shop Pet Supplies at Low Prices — Only at Honey",
  "What did you think?",
  "New products & features from Ship 2026",
  "LAST chance to claim your Birthday Gift 🎂",
  "National Lip Day is here — new deals daily",
  "We Have a Discount for You! 🎉",
  "Remember this?",
  "Time to start earning!",
];

it("treats a parse with no amount, no order id and no structured data as no evidence", () => {
  expect(hasPurchaseEvidence({ rawSource: "text" })).toBe(false);
  expect(hasPurchaseEvidence({ rawSource: "text", totalCents: undefined, orderId: undefined })).toBe(false);
});

it("accepts an amount, an order id, or structured JSON-LD as evidence", () => {
  expect(hasPurchaseEvidence({ rawSource: "text", totalCents: 4299 })).toBe(true);
  expect(hasPurchaseEvidence({ rawSource: "text", orderId: "112-9948" })).toBe(true);
  expect(hasPurchaseEvidence({ rawSource: "jsonld" })).toBe(true);
  expect(hasPurchaseEvidence({ rawSource: "pdf", totalCents: 1000 })).toBe(true);
});

it("rejects a zero total as evidence", () => {
  // A $0.00 line is almost always a promo or a shipping-free notice.
  expect(hasPurchaseEvidence({ rawSource: "text", totalCents: 0 })).toBe(false);
});

it("keeps a future auto-renewal amount out of completed purchases", () => {
  const notice = {
    rawSource: "text" as const,
    subject: "Shaheed, here's your auto-renewal notice",
    totalCents: 1868,
    textBody: "We'll attempt to charge your total balance of $18.68 on the day of renewal.",
  };

  expect(hasProspectiveChargeEvidence(notice)).toBe(true);
  expect(hasPurchaseEvidence(notice)).toBe(false);
});

it("does not demote a completed order that also discusses renewals", () => {
  const receipt = {
    rawSource: "text" as const,
    subject: "Namecheap Order Summary (Order# 181889957)",
    totalCents: 1148,
    textBody: "Initial Charge: $11.48. We encourage auto-renewal for your domains.",
  };

  expect(hasProspectiveChargeEvidence(receipt)).toBe(false);
  expect(hasPurchaseEvidence(receipt)).toBe(true);
});

it("keeps an invoice awaiting an automatic card charge out of completed purchases", () => {
  const invoice = {
    rawSource: "text" as const,
    subject: "[billing] Heroku Invoice for July 2026 (Invoice #113242336)",
    totalCents: 101,
    orderId: "113242336",
    textBody: [
      "Your Heroku invoice for July 2026 is now available.",
      "We will charge your credit card $1.01 within the next two business days.",
      "TOTAL CHARGE: $1.01",
    ].join("\n"),
  };

  // An invoice number and payable total identify the obligation, not a
  // completed transfer. The explicit future-tense charge controls.
  expect(hasProspectiveChargeEvidence(invoice)).toBe(true);
  expect(hasPurchaseEvidence(invoice)).toBe(false);
  expect(classifyReceiptEmail(invoice.subject, invoice.textBody)).toBe("BILL");
});

it("refuses to classify marketing email that carries no purchase signal", () => {
  for (const subject of OBSERVED_NEWSLETTERS) {
    expect(classifyReceiptEmail(subject, "Shop now and save big on everything."), subject).toBe(null);
  }
});

it("does not read a newsletter opt-in as a paid subscription", () => {
  // Observed verbatim from cobiabeauty.com — the old classifier saw
  // "Subscription" and called it a SUBSCRIPTION.
  expect(classifyReceiptEmail("Confirm Your Subscription", "Click here to confirm you want our emails.")).toBe(null);
});

it("classifies a paid subscription renewal", () => {
  expect(classifyReceiptEmail("Your Netflix membership renews soon", "Your subscription renews on Sept 3 for $16.49.")).toBe("SUBSCRIPTION");
});

it("classifies a bill or invoice", () => {
  expect(classifyReceiptEmail("Your monthly statement is ready", "Your statement is available. Amount due $84.20.")).toBe("BILL");
  expect(classifyReceiptEmail("Invoice #4471 from Vercel", "Invoice total $20.00")).toBe("BILL");
});

it("classifies a goods order as returnable", () => {
  expect(classifyReceiptEmail("Your order has shipped", "Order #112-9948 is on its way.")).toBe("RETURN");
  expect(classifyReceiptEmail("Order confirmation", "Thanks for your order! Order total $42.99")).toBe("RETURN");
});

it("classifies a plain purchase receipt", () => {
  // Without this, a genuine receipt that never says "order" would fall
  // through to null and produce no suggestion at all.
  expect(classifyReceiptEmail("Your receipt from Apple", "Total charged $12.99")).toBe("RETURN");
  expect(classifyReceiptEmail("Thanks for your purchase", "We received your payment.")).toBe("RETURN");
});
