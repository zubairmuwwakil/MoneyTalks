import { describe, expect, it } from "vitest";
import {
  accountInput,
  holdingInput,
  IMPORT_LIMITS,
  importFile,
  snapshotInput,
  transactionInput,
} from "./investments";

// Money is entered in DOLLARS and stored as integer cents, so the Prisma Int
// boundary is expressed here as the dollar value that lands exactly on it.
const MAX_DOLLARS = "21474836.47"; // -> 2_147_483_647 cents
const MIN_DOLLARS = "-21474836.48"; // -> -2_147_483_648 cents
const OVER_MAX_DOLLARS = "21474836.48";
const UNDER_MIN_DOLLARS = "-21474836.49";

describe("accountInput", () => {
  it("accepts a valid account", () => {
    const parsed = accountInput.safeParse({
      type: "RRSP",
      name: "Maple RRSP",
      institution: "Maple Invest",
      country: "CA",
      currency: "CAD",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown types and bad country codes", () => {
    expect(accountInput.safeParse({ type: "SLUSH_FUND", name: "x", institution: "y", country: "CA", currency: "CAD" }).success).toBe(false);
    expect(accountInput.safeParse({ type: "TFSA", name: "x", institution: "y", country: "Canada", currency: "CAD" }).success).toBe(false);
  });

  it("parses the explicit false FormData value as false", () => {
    const parsed = accountInput.safeParse({
      type: "TFSA",
      name: "Test account",
      institution: "Test institution",
      country: "CA",
      currency: "CAD",
      isUSSitus: "false",
    });
    expect(parsed).toMatchObject({ success: true, data: { isUSSitus: false } });
  });
});

describe("transactionInput", () => {
  it("takes dollars, stores cents, and requires a positive amount", () => {
    const ok = transactionInput.safeParse({ type: "CONTRIBUTION", amount: "50.00", currency: "CAD", date: "2026-08-01" });
    expect(ok).toMatchObject({ success: true, data: { amountMinor: 5000 } });
    // A bare dollar figure and a formatted one land on the same cents.
    expect(transactionInput.safeParse({ type: "CONTRIBUTION", amount: "$1,234.56", currency: "CAD", date: "2026-08-01" }))
      .toMatchObject({ success: true, data: { amountMinor: 123456 } });
    expect(transactionInput.safeParse({ type: "CONTRIBUTION", amount: "-50.00", currency: "CAD", date: "2026-08-01" }).success).toBe(false);
    // Sub-cent precision is not representable and must not silently round.
    expect(transactionInput.safeParse({ type: "CONTRIBUTION", amount: "50.555", currency: "CAD", date: "2026-08-01" }).success).toBe(false);
    expect(transactionInput.safeParse({ type: "CONTRIBUTION", amount: "not money", currency: "CAD", date: "2026-08-01" }).success).toBe(false);
  });

  it("rejects impossible and trailing calendar dates", () => {
    expect(transactionInput.safeParse({ type: "CONTRIBUTION", amount: "50.00", currency: "CAD", date: "2026-02-31" }).success).toBe(false);
    expect(transactionInput.safeParse({ type: "CONTRIBUTION", amount: "50.00", currency: "CAD", date: "2026-08-01junk" }).success).toBe(false);
  });

  it("rejects amounts outside the signed Prisma Int range", () => {
    const transaction = {
      type: "CONTRIBUTION",
      currency: "CAD",
      date: "2026-08-01",
    };

    expect(transactionInput.safeParse({ ...transaction, amount: MAX_DOLLARS }))
      .toMatchObject({ success: true, data: { amountMinor: 2_147_483_647 } });
    expect(transactionInput.safeParse({ ...transaction, amount: OVER_MAX_DOLLARS }).success).toBe(false);
  });
});

describe("holdingInput", () => {
  const holding = {
    symbol: "TEST",
    name: "Fictional holding",
    domicileCountry: "CA",
    quantity: 1,
    priceAsOf: "2026-08-01",
  };

  it("rejects price and book-cost amounts above the signed Prisma Int range", () => {
    expect(holdingInput.safeParse({ ...holding, lastPrice: "30.00" }))
      .toMatchObject({ success: true, data: { lastPriceMinor: 3000 } });
    expect(holdingInput.safeParse({ ...holding, lastPrice: MAX_DOLLARS }).success).toBe(true);
    expect(holdingInput.safeParse({ ...holding, lastPrice: OVER_MAX_DOLLARS }).success).toBe(false);
    expect(
      holdingInput.safeParse({ ...holding, lastPrice: "1.00", bookCost: OVER_MAX_DOLLARS }).success,
    ).toBe(false);
  });
});

describe("snapshotInput", () => {
  it("accepts Int boundaries and rejects balances outside them", () => {
    expect(snapshotInput.safeParse({ balance: MIN_DOLLARS, asOf: "2026-08-01" }).success).toBe(true);
    expect(snapshotInput.safeParse({ balance: MAX_DOLLARS, asOf: "2026-08-01" }).success).toBe(true);
    expect(snapshotInput.safeParse({ balance: UNDER_MIN_DOLLARS, asOf: "2026-08-01" }).success).toBe(false);
    expect(snapshotInput.safeParse({ balance: OVER_MAX_DOLLARS, asOf: "2026-08-01" }).success).toBe(false);
    // A negative balance is legitimate (an overdrawn chequing account).
    expect(snapshotInput.safeParse({ balance: "-120.50", asOf: "2026-08-01" }))
      .toMatchObject({ success: true, data: { balanceMinor: -12050 } });
  });
});

describe("importFile", () => {
  it("accepts a nested accounts + fxRates document", () => {
    const parsed = importFile.safeParse({
      accounts: [
        {
          type: "TFSA",
          name: "Maple TFSA",
          institution: "Maple Invest",
          country: "CA",
          currency: "CAD",
          holdings: [
            { symbol: "XEQT.TO", name: "Fictional All-Equity ETF", domicileCountry: "CA", quantity: 10, lastPrice: 30.0, priceAsOf: "2026-08-01" },
          ],
          snapshots: [{ balance: 300.0, asOf: "2026-08-01" }],
        },
      ],
      fxRates: [{ base: "USD", quote: "CAD", rate: 1.4, asOf: "2026-08-01" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an fx rate with base === quote", () => {
    expect(importFile.safeParse({ accounts: [], fxRates: [{ base: "CAD", quote: "CAD", rate: 1, asOf: "2026-08-01" }] }).success).toBe(false);
  });

  it("rejects import files above the explicit account and row limits", () => {
    const account = {
      type: "TFSA",
      name: "Maple TFSA",
      institution: "Maple Invest",
      country: "CA",
      currency: "CAD",
    };

    expect(
      importFile.safeParse({
        accounts: Array.from({ length: IMPORT_LIMITS.accounts + 1 }, (_, index) => ({
          ...account,
          name: `Maple TFSA ${index}`,
        })),
      }).success,
    ).toBe(false);

    expect(
      importFile.safeParse({
        accounts: [
          ...Array.from({ length: 11 }, (_, accountIndex) => ({
            ...account,
            name: `Maple TFSA ${accountIndex}`,
            holdings: Array.from({ length: IMPORT_LIMITS.holdingsPerAccount }, (_, holdingIndex) => ({
              symbol: `T${accountIndex}-${holdingIndex}`,
              name: `Fictional Holding ${accountIndex}-${holdingIndex}`,
              domicileCountry: "CA",
              quantity: 1,
              lastPriceMinor: 100,
              priceAsOf: "2026-08-01",
            })),
          })),
        ],
      }).success,
    ).toBe(false);
  });

  it("sets an explicit raw upload byte limit before parsing", () => {
    expect(IMPORT_LIMITS.fileBytes).toBeGreaterThan(0);
    expect(IMPORT_LIMITS.fileBytes).toBeLessThanOrEqual(5 * 1024 * 1024);
  });
});
