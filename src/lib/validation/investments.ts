import { z } from "zod";

export const currencyCode = z.enum(["CAD", "USD", "JMD"]);
const countryCode = z.string().regex(/^[A-Z]{2}$/, "ISO-3166 alpha-2, e.g. CA");
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "ISO 8601 date, e.g. 2026-08-01")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, "Must be a valid calendar date");
const minorUnits = z.coerce.number().int().safe();
const positiveMinor = minorUnits.positive();
const formBoolean = z
  .union([z.boolean(), z.literal("true"), z.literal("false")])
  .transform((value) => value === true || value === "true")
  .default(false);

export const accountInput = z.object({
  type: z.enum(["RRSP", "TFSA", "RDSP", "FHSA", "ROTH_IRA", "NON_REGISTERED", "CASH", "CHEQUING", "CRYPTO"]),
  name: z.string().trim().min(1).max(80),
  institution: z.string().trim().min(1).max(80),
  country: countryCode,
  currency: currencyCode,
  isUSSitus: formBoolean,
});

export const holdingInput = z.object({
  symbol: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(80),
  domicileCountry: countryCode,
  quantity: z.coerce.number().positive().finite(),
  bookCostMinor: minorUnits.nonnegative().optional(),
  lastPriceMinor: minorUnits.nonnegative(),
  priceAsOf: isoDate,
});

export const transactionInput = z.object({
  type: z.enum(["CONTRIBUTION", "WITHDRAWAL", "BUY", "SELL", "DIVIDEND", "INTEREST", "FEE"]),
  amountMinor: positiveMinor,
  currency: currencyCode,
  date: isoDate,
  description: z.string().trim().max(200).optional(),
});

export const snapshotInput = z.object({
  balanceMinor: minorUnits,
  asOf: isoDate,
});

export const fxRateInput = z
  .object({
    base: currencyCode,
    quote: currencyCode,
    rate: z.coerce.number().positive().finite(),
    asOf: isoDate,
  })
  .refine((r) => r.base !== r.quote, { message: "base and quote must differ" });

export const importFile = z.object({
  accounts: z.array(
    accountInput.extend({
      holdings: z.array(holdingInput).optional(),
      snapshots: z.array(snapshotInput).optional(),
    }),
  ),
  fxRates: z.array(fxRateInput).optional(),
});

export type AccountInput = z.infer<typeof accountInput>;
export type ImportFile = z.infer<typeof importFile>;
