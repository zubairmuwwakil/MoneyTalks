import { describe, expect, it } from "vitest";
import { cardImportEntry } from "./cards";

describe("cardImportEntry", () => {
  it("accepts Discover when the selected catalogue card uses that network", () => {
    const parsed = cardImportEntry.safeParse({
      contractCardId: "discover-it-cash-back",
      nickname: "Discover it Cash Back",
      issuer: "Discover",
      network: "DISCOVER",
      annualFee: "0",
      feeRebate: "0",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.network).toBe("DISCOVER");
  });

  it("accepts the string-valued numeric fields submitted by the card form", () => {
    const parsed = cardImportEntry.safeParse({
      contractCardId: "amex-cobalt",
      nickname: "Browser form card",
      issuer: "Fixture Bank",
      network: "VISA",
      annualFee: "120.00",
      feeRebate: "20.00",
      dueDay: "15",
      aprPct: "19.99",
    });

    expect(parsed).toMatchObject({
      success: true,
      data: {
        contractCardId: "amex-cobalt",
        annualFeeMinor: 12_000,
        feeRebateMinor: 2_000,
        dueDay: 15,
        aprPct: 19.99,
      },
    });
  });

  it("accepts a full card entry and converts its dollar amounts", () => {
    const parsed = cardImportEntry.safeParse({
      nickname: "Fixture Alpha Amex",
      issuer: "Fixture Financial",
      network: "AMEX",
      annualFee: 150,
      limit: 10_000,
      dueDay: 15,
    });
    expect(parsed).toMatchObject({
      success: true,
      data: { annualFeeMinor: 15_000, limitMinor: 1_000_000 },
    });
  });

  it("defaults a missing annual fee to zero", () => {
    const parsed = cardImportEntry.safeParse({
      nickname: "No Fee Card",
      issuer: "Fixture Bank",
      network: "VISA",
    });
    expect(parsed).toMatchObject({ success: true, data: { annualFeeMinor: 0 } });
  });

  // An unlinked row is a real state: an import cannot know which catalogue
  // product a card is, and the card still works without rates until the owner
  // links it. Guessing the link would silently rescore their spend.
  it("accepts a card with no catalogue link and defaults its rebate to zero", () => {
    const parsed = cardImportEntry.safeParse({
      nickname: "Unlinked card",
      issuer: "Fixture Bank",
      network: "VISA",
    });

    expect(parsed).toMatchObject({ success: true, data: { feeRebateMinor: 0 } });
  });

  it("rejects a bad network and out-of-range due days", () => {
    const good = {
      nickname: "x",
      issuer: "y",
      network: "AMEX",
    };
    expect(cardImportEntry.safeParse({ ...good, network: "DINERS" }).success).toBe(false);
    expect(cardImportEntry.safeParse({ ...good, dueDay: 31 }).success).toBe(false);
  });

  it("accepts empty strings for optional fields as submitted by the browser form", () => {
    const parsed = cardImportEntry.safeParse({
      contractCardId: "amex-platinum",
      nickname: "The Platinum Card from American Express",
      issuer: "American Express Canada",
      network: "AMEX",
      lastFour: "",
      country: "CA",
      currency: "CAD",
      limit: "",
      statementDay: "",
      dueDay: "",
      aprPct: "",
      annualFee: "799.00",
      feeRebate: "0",
      feeMonthDay: "",
      feeCancelGraceDays: "30",
    });

    expect(parsed).toMatchObject({
      success: true,
      data: {
        contractCardId: "amex-platinum",
        nickname: "The Platinum Card from American Express",
        issuer: "American Express Canada",
        network: "AMEX",
        annualFeeMinor: 79_900,
        feeRebateMinor: 0,
        feeCancelGraceDays: 30,
        country: "CA",
        currency: "CAD",
      },
    });
    if (parsed.success) {
      expect(parsed.data.lastFour).toBeUndefined();
      expect(parsed.data.limitMinor).toBeUndefined();
      expect(parsed.data.statementDay).toBeUndefined();
      expect(parsed.data.dueDay).toBeUndefined();
      expect(parsed.data.aprPct).toBeUndefined();
      expect(parsed.data.feeMonthDay).toBeUndefined();
    }
  });

  it("rejects a fee rebate above the card's annual fee", () => {
    expect(
      cardImportEntry.safeParse({
        nickname: "Over-rebated",
        issuer: "Fixture Bank",
        network: "VISA",
        annualFee: 10,
        feeRebate: 11,
      }).success,
    ).toBe(false);
  });
});
