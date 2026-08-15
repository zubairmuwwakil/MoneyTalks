import { z } from "zod";

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

/** An unchecked checkbox omits its key; a hand-written import file may say "false". */
export const formBoolean = z
  .union([z.boolean(), z.literal("true"), z.literal("false")])
  .transform((value) => value === true || value === "true")
  .default(false);
