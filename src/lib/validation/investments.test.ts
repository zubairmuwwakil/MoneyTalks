import { describe, expect, it } from "vitest";
import { accountInput, importFile, transactionInput } from "./investments";

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
});

describe("transactionInput", () => {
  it("coerces form-data strings and requires positive integers", () => {
    expect(transactionInput.safeParse({ type: "CONTRIBUTION", amountMinor: "5000", currency: "CAD", date: "2026-08-01" }).success).toBe(true);
    expect(transactionInput.safeParse({ type: "CONTRIBUTION", amountMinor: "-5000", currency: "CAD", date: "2026-08-01" }).success).toBe(false);
    expect(transactionInput.safeParse({ type: "CONTRIBUTION", amountMinor: "50.5", currency: "CAD", date: "2026-08-01" }).success).toBe(false);
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
});
