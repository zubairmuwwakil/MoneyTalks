import { z } from "zod";
import { billImportEntry } from "./bills";
import { cardImportEntry } from "./cards";
import { countryCode, currencyCode, dollarAmount, formBoolean, isoDate } from "./primitives";

export const IMPORT_LIMITS = {
  fileBytes: 5 * 1024 * 1024,
  accounts: 100,
  holdingsPerAccount: 1000,
  snapshotsPerAccount: 5000,
  fxRates: 10000,
  bills: 500,
  cards: 100,
  totalRows: 10000,
} as const;

export const accountInput = z.object({
  type: z.enum(["RRSP", "TFSA", "RDSP", "FHSA", "ROTH_IRA", "NON_REGISTERED", "CASH", "CHEQUING", "CRYPTO"]),
  name: z.string().trim().min(1).max(80),
  institution: z.string().trim().min(1).max(80),
  country: countryCode,
  currency: currencyCode,
  isUSSitus: formBoolean,
});

export const holdingInput = z
  .object({
    symbol: z.string().trim().min(1).max(20),
    name: z.string().trim().min(1).max(80),
    domicileCountry: countryCode,
    quantity: z.coerce.number().positive().finite(),
    bookCost: dollarAmount({ min: 0 }).optional(),
    lastPrice: dollarAmount({ min: 0 }),
    priceAsOf: isoDate,
  })
  .transform(({ bookCost, lastPrice, ...rest }) => ({
    ...rest,
    bookCostMinor: bookCost,
    lastPriceMinor: lastPrice,
  }));

export const transactionInput = z
  .object({
    type: z.enum(["CONTRIBUTION", "WITHDRAWAL", "BUY", "SELL", "DIVIDEND", "INTEREST", "FEE"]),
    amount: dollarAmount({ min: 1 }),
    date: isoDate,
    description: z.string().trim().max(200).optional(),
  })
  .transform(({ amount, ...rest }) => ({ ...rest, amountMinor: amount }));

export const snapshotInput = z
  .object({
    balance: dollarAmount(),
    asOf: isoDate,
  })
  .transform(({ balance, ...rest }) => ({ ...rest, balanceMinor: balance }));

export const fxRateInput = z
  .object({
    base: currencyCode,
    quote: currencyCode,
    rate: z.coerce.number().positive().finite(),
    asOf: isoDate,
  })
  .refine((r) => r.base !== r.quote, { message: "base and quote must differ" });

export const importFile = z
  .object({
    accounts: z
      .array(
        accountInput.extend({
          holdings: z.array(holdingInput).max(IMPORT_LIMITS.holdingsPerAccount).optional(),
          snapshots: z.array(snapshotInput).max(IMPORT_LIMITS.snapshotsPerAccount).optional(),
        }),
      )
      .max(IMPORT_LIMITS.accounts),
    fxRates: z.array(fxRateInput).max(IMPORT_LIMITS.fxRates).optional(),
    bills: z.array(billImportEntry).max(IMPORT_LIMITS.bills).optional(),
    cards: z.array(cardImportEntry).max(IMPORT_LIMITS.cards).optional(),
  })
  .superRefine((data, ctx) => {
    const totalRows =
      data.accounts.length +
      data.accounts.reduce((sum, account) => sum + (account.holdings?.length ?? 0) + (account.snapshots?.length ?? 0), 0) +
      (data.fxRates?.length ?? 0) +
      (data.bills?.length ?? 0) +
      (data.cards?.length ?? 0);
    if (totalRows > IMPORT_LIMITS.totalRows) {
      ctx.addIssue({
        code: "custom",
        message: `Import contains ${totalRows} rows; maximum is ${IMPORT_LIMITS.totalRows}`,
      });
    }
  });

export type AccountInput = z.infer<typeof accountInput>;
export type ImportFile = z.infer<typeof importFile>;
