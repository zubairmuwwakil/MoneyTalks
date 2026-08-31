import { describe, expect, it } from "vitest";
import { extractPriceChangeFacts } from "./extractPriceChangeFacts";

const occurredAt = new Date("2026-08-30T12:00:00.000Z");

describe("extractPriceChangeFacts", () => {
  it("extracts price increase notice with new amount and effective date", () => {
    const facts = extractPriceChangeFacts({
      subject: "Upcoming price increase for your plan",
      textBody: "Starting 2026-10-01, your plan price will increase to CAD 17.99 per month.",
      occurredAt,
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      type: "PRICE_CHANGE",
      extractorId: "price-change",
      extractorVersion: 1,
      factKey: "",
      occurredAt,
      effectiveAt: new Date("2026-10-01T12:00:00.000Z"),
      amountMinor: 1799,
    });
    expect(facts[0].evidenceSnippet).toContain("price will increase");
  });

  it("extracts rate change without amount or explicit date", () => {
    const facts = extractPriceChangeFacts({
      subject: "Your subscription rate has changed",
      textBody: "We updated our subscription rate terms.",
      occurredAt,
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      type: "PRICE_CHANGE",
      extractorId: "price-change",
      extractorVersion: 1,
      factKey: "",
      occurredAt,
      amountMinor: undefined,
      effectiveAt: undefined,
    });
  });

  it("ignores marketing emails without price changes", () => {
    const facts = extractPriceChangeFacts({
      subject: "Best prices on all items",
      textBody: "Shop our summer sale today.",
      occurredAt,
    });

    expect(facts).toEqual([]);
  });
});

describe("price change scoped to the clause that states it", () => {
  const occurredAt = new Date("2026-08-30T12:00:00.000Z");

  it("takes the new price, not an earlier quoted current price", () => {
    const facts = extractPriceChangeFacts({
      subject: "Your plan price is changing",
      textBody:
        "Invoice date: September 2, 2026. Your plan renews monthly. "
        + "Your current price is $9.99. "
        + "From October 1, 2026 your price will increase to $29.99.",
      occurredAt,
    });

    expect(facts).toHaveLength(1);
    expect(facts[0].amountMinor).toBe(2999);
    expect(facts[0].effectiveAt).toEqual(new Date("2026-10-01T12:00:00.000Z"));
  });
});
