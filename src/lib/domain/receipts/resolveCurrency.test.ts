import { describe, expect, it } from "vitest";
import { reconcileCurrency, resolveCurrency, shouldAutoApply } from "./resolveCurrency";

describe("the ladder resolves in strict order", () => {
  it("puts the owner's correction above contradicting receipt evidence", () => {
    const result = resolveCurrency({
      ownerCurrency: "EUR",
      messageText: "Order total: USD $120.00\nAll amounts in USD.",
      markupCurrency: "USD",
    });
    expect(result.currency).toBe("EUR");
    expect(result.source).toBe("userOverride");
    expect(result.confidence).toBe("certain");
  });

  it("puts an explicit code in the message above structured markup", () => {
    const result = resolveCurrency({
      messageText: "Total: $120.00\nAll amounts in CAD.",
      markupCurrency: "USD",
    });
    expect(result.currency).toBe("CAD");
    expect(result.source).toBe("explicitCode");
  });

  it("falls back to structured markup when the body states no code", () => {
    const result = resolveCurrency({ messageText: "Total: $120.00", markupCurrency: "usd" });
    expect(result.currency).toBe("USD");
    expect(result.source).toBe("structuredMarkup");
  });

  it("keeps an explicit code above the owner's learned merchant currency", () => {
    const result = resolveCurrency({
      messageText: "Total CAD 1.01",
      ownerConfirmedMerchantCurrency: "USD",
    });
    expect(result).toMatchObject({ currency: "CAD", source: "explicitCode" });
  });

  it("uses a learned merchant currency only after message-local evidence is exhausted", () => {
    const result = resolveCurrency({
      messageText: "Total $1.01",
      ownerConfirmedMerchantCurrency: "usd",
    });
    expect(result).toMatchObject({ currency: "USD", source: "ownerConfirmedForMerchant" });
  });
});

describe("explicit codes in the message body", () => {
  it("reads a footer code when the total line carries only a bare dollar sign", () => {
    const text = [
      "Anthropic PBC",
      "Claude Pro subscription",
      "Total $120.00",
      "All amounts are in USD.",
    ].join("\n");
    const result = resolveCurrency({ messageText: text });
    expect(result.currency).toBe("USD");
    expect(result.source).toBe("explicitCode");
  });

  it("reads CA$ on the total line as Canadian dollars", () => {
    const result = resolveCurrency({ messageText: "Order total: CA$84.19" });
    expect(result.currency).toBe("CAD");
    expect(result.source).toBe("explicitCode");
  });

  it("reads Can$ as Canadian dollars", () => {
    const result = resolveCurrency({ messageText: "Grand total Can$ 84.19" });
    expect(result.currency).toBe("CAD");
  });

  it("reads a code written against a thousands-separated amount", () => {
    const result = resolveCurrency({ messageText: "Amount charged: USD 1,234.56" });
    expect(result.currency).toBe("USD");
    expect(result.source).toBe("explicitCode");
  });

  it("does not read a code out of the middle of a word", () => {
    // "USD" inside a tracking number or a URL is a coincidence, not a claim.
    const result = resolveCurrency({
      messageText: "Track your parcel: 1ZUSDX9910\nhttps://ship.example/CADENCE\nTotal $42.00",
    });
    expect(result.currency).toBeNull();
    expect(result.source).toBe("none");
  });

  it("stays unresolved when the message names two different currencies", () => {
    // A converted receipt quotes both. First-wins here would be a coin flip
    // dressed as a reading.
    const result = resolveCurrency({
      messageText: "Subtotal: USD 90.00\nCharged to your card: CAD 124.11",
    });
    expect(result.currency).toBeNull();
    expect(result.source).toBe("none");
  });

  it("treats a code repeated in one message as a single unambiguous claim", () => {
    const result = resolveCurrency({
      messageText: "Subtotal USD 90.00\nTax USD 11.70\nTotal USD 101.70",
    });
    expect(result.currency).toBe("USD");
    expect(result.source).toBe("explicitCode");
  });
});

describe("refusing to guess", () => {
  it("leaves a receipt with no currency evidence unresolved rather than assuming CAD", () => {
    const result = resolveCurrency({ messageText: "Simons\nOrder total: $84.19\nThank you!" });
    expect(result.currency).toBeNull();
    expect(result.source).toBe("none");
    expect(result.confidence).toBe("none");
  });

  it("resolves nothing from an empty message", () => {
    const result = resolveCurrency({});
    expect(result.currency).toBeNull();
    expect(result.source).toBe("none");
  });

  it("ignores a markup value that is not a three-letter code", () => {
    const result = resolveCurrency({ markupCurrency: "$" });
    expect(result.currency).toBeNull();
    expect(result.source).toBe("none");
  });
});

describe("the auto-apply gate", () => {
  it("lets an owner correction and a read code through", () => {
    expect(shouldAutoApply(resolveCurrency({ ownerCurrency: "CAD" }))).toBe(true);
    expect(shouldAutoApply(resolveCurrency({ messageText: "Total USD 5.00" }))).toBe(true);
    expect(shouldAutoApply(resolveCurrency({ markupCurrency: "USD" }))).toBe(true);
  });

  it("holds back an unresolved reading", () => {
    expect(shouldAutoApply(resolveCurrency({ messageText: "Total $5.00" }))).toBe(false);
  });
});

describe("reconciling a receipt reading with the purchase's other observations", () => {
  const readUsd = { currency: "USD", source: "explicitCode" as const };
  const readNothing = { currency: null, source: "none" as const };

  it("keeps an owner-corrected currency when reprocessing re-reads the receipt", () => {
    // The regression this guards: reprocessing overwrote Purchase.currency
    // unconditionally, so a correction survived only until the next scan.
    const result = reconcileCurrency({ ownerCurrency: "CAD", receipt: readUsd });
    expect(result.currency).toBe("CAD");
    expect(result.source).toBe("userOverride");
  });

  it("keeps an owner correction even against a linked wallet observation", () => {
    const result = reconcileCurrency({
      ownerCurrency: "CAD",
      receipt: readNothing,
      walletCurrency: "USD",
    });
    expect(result.currency).toBe("CAD");
    expect(result.source).toBe("userOverride");
  });

  it("prefers the receipt's own reading over a linked wallet observation", () => {
    const result = reconcileCurrency({ receipt: readUsd, walletCurrency: "CAD" });
    expect(result.currency).toBe("USD");
    expect(result.source).toBe("explicitCode");
  });

  it("falls back to a linked wallet observation when the receipt stays ambiguous", () => {
    const result = reconcileCurrency({ receipt: readNothing, walletCurrency: "cad" });
    expect(result.currency).toBe("CAD");
    expect(result.source).toBe("walletObservation");
  });

  it("lets a linked wallet observation outrank a learned merchant currency", () => {
    const result = reconcileCurrency({
      receipt: { currency: "USD", source: "ownerConfirmedForMerchant" },
      walletCurrency: "CAD",
    });
    expect(result).toEqual({ currency: "CAD", source: "walletObservation" });
  });

  it("stays unresolved when neither the receipt nor a wallet capture states a currency", () => {
    const result = reconcileCurrency({ receipt: readNothing });
    expect(result.currency).toBeNull();
    expect(result.source).toBe("none");
  });

  it("ignores an owner value that is not a currency code", () => {
    const result = reconcileCurrency({ ownerCurrency: "  ", receipt: readUsd });
    expect(result.currency).toBe("USD");
    expect(result.source).toBe("explicitCode");
  });
});

describe("every resolution carries a rationale a human can audit", () => {
  it("names the evidence it read", () => {
    expect(resolveCurrency({ messageText: "Total USD 5.00" }).rationale).toContain("USD");
    expect(resolveCurrency({ messageText: "Total $5.00" }).rationale).toMatch(/no currency/i);
  });
});
