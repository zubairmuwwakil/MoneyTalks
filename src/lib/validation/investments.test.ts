import { describe, expect, it } from "vitest";
import {
  accountInput,
  holdingInput,
  IMPORT_LIMITS,
  importFile,
  snapshotInput,
  transactionInput,
} from "./investments";

const PRISMA_INT_MIN = -2_147_483_648;
const PRISMA_INT_MAX = 2_147_483_647;

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
  it("coerces form-data strings and requires positive integers", () => {
    expect(transactionInput.safeParse({ type: "CONTRIBUTION", amountMinor: "5000", currency: "CAD", date: "2026-08-01" }).success).toBe(true);
    expect(transactionInput.safeParse({ type: "CONTRIBUTION", amountMinor: "-5000", currency: "CAD", date: "2026-08-01" }).success).toBe(false);
    expect(transactionInput.safeParse({ type: "CONTRIBUTION", amountMinor: "50.5", currency: "CAD", date: "2026-08-01" }).success).toBe(false);
  });

  it("rejects impossible and trailing calendar dates", () => {
    expect(transactionInput.safeParse({ type: "CONTRIBUTION", amountMinor: "5000", currency: "CAD", date: "2026-02-31" }).success).toBe(false);
    expect(transactionInput.safeParse({ type: "CONTRIBUTION", amountMinor: "5000", currency: "CAD", date: "2026-08-01junk" }).success).toBe(false);
  });

  it("rejects amounts outside the signed Prisma Int range", () => {
    const transaction = {
      type: "CONTRIBUTION",
      currency: "CAD",
      date: "2026-08-01",
    };

    expect(transactionInput.safeParse({ ...transaction, amountMinor: PRISMA_INT_MAX }).success).toBe(true);
    expect(transactionInput.safeParse({ ...transaction, amountMinor: PRISMA_INT_MAX + 1 }).success).toBe(false);
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
    expect(holdingInput.safeParse({ ...holding, lastPriceMinor: PRISMA_INT_MAX }).success).toBe(true);
    expect(holdingInput.safeParse({ ...holding, lastPriceMinor: PRISMA_INT_MAX + 1 }).success).toBe(false);
    expect(
      holdingInput.safeParse({ ...holding, lastPriceMinor: 1, bookCostMinor: PRISMA_INT_MAX + 1 }).success,
    ).toBe(false);
  });
});

describe("snapshotInput", () => {
  it("accepts Int boundaries and rejects balances outside them", () => {
    expect(snapshotInput.safeParse({ balanceMinor: PRISMA_INT_MIN, asOf: "2026-08-01" }).success).toBe(true);
    expect(snapshotInput.safeParse({ balanceMinor: PRISMA_INT_MAX, asOf: "2026-08-01" }).success).toBe(true);
    expect(snapshotInput.safeParse({ balanceMinor: PRISMA_INT_MIN - 1, asOf: "2026-08-01" }).success).toBe(false);
    expect(snapshotInput.safeParse({ balanceMinor: PRISMA_INT_MAX + 1, asOf: "2026-08-01" }).success).toBe(false);
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
            { symbol: "XEQT.TO", name: "Fictional All-Equity ETF", domicileCountry: "CA", quantity: 10, lastPriceMinor: 3000, priceAsOf: "2026-08-01" },
          ],
          snapshots: [{ balanceMinor: 30000, asOf: "2026-08-01" }],
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
          {
            ...account,
            holdings: Array.from({ length: IMPORT_LIMITS.totalRows + 1 }, (_, index) => ({
              symbol: `T${index}`,
              name: `Fictional Holding ${index}`,
              domicileCountry: "CA",
              quantity: 1,
              lastPriceMinor: 100,
              priceAsOf: "2026-08-01",
            })),
          },
        ],
      }).success,
    ).toBe(false);
  });
});
