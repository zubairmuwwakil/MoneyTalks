import { z } from "zod";
import { parseDollarsToMinor } from "@/engine/money";

/**
 * Field-level validators shared by every import/form schema. They live apart
 * from the domain schemas so that bills.ts and investments.ts can both use
 * them without importing each other.
 */

export const currencyCode = z.enum(["CAD", "USD", "JMD"]);

export const countryCode = z.string().regex(/^[A-Z]{2}$/, "ISO-3166 alpha-2, e.g. CA");

/** Rejects well-formed but impossible dates (2026-02-31) — these feed the date engine. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "ISO 8601 date, e.g. 2026-08-01")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, "Must be a valid calendar date");

/** Bounded to the Postgres int4 range that backs every *Minor column. */
export const minorUnits = z.coerce.number().int().min(-2_147_483_648).max(2_147_483_647);

export const PRISMA_INT_MIN = -2_147_483_648;
export const PRISMA_INT_MAX = 2_147_483_647;

/**
 * Money crosses into this app as DOLLARS and is stored as integer minor units.
 * Nobody should ever type 12000 to mean $120 - people think in dollars, and a
 * misplaced factor of 100 in a finance app is not a typo you notice.
 *
 * Accepts a number (120, 120.5) or a string ("1,234.56", "$99"), rejects
 * sub-cent precision, and bounds the resulting cents to the int4 range that
 * backs every *Minor column, so an oversized entry is a field error rather
 * than a Postgres write failure. The message is phrased in dollars because
 * that is the unit the user typed - quoting the cents ceiling would mislead
 * by exactly the factor this helper exists to remove.
 */
export function dollarAmount(
  opts: { min?: number; max?: number } = {},
): z.ZodType<number, unknown> {
  const min = opts.min ?? PRISMA_INT_MIN;
  const max = opts.max ?? PRISMA_INT_MAX;
  const asDollars = (minor: number) =>
    (minor / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
  return z
    .union([z.number(), z.string()])
    .transform((raw, ctx) => {
      const minor = parseDollarsToMinor(String(raw));
      if (minor === null) {
        ctx.addIssue({ code: "custom", message: "Must be a dollar amount, e.g. 1234.56" });
        return z.NEVER;
      }
      return minor;
    })
    .pipe(
      z
        .number()
        .int()
        .min(min, `Must be ${asDollars(min)} or more`)
        .max(max, `Must be ${asDollars(max)} or less`),
    ) as unknown as z.ZodType<number, unknown>;
}

/** An unchecked checkbox omits its key; a hand-written import file may say "false". */
export const formBoolean = z
  .union([z.boolean(), z.literal("true"), z.literal("false")])
  .transform((value) => value === true || value === "true")
  .default(false);
