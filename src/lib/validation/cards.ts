import { z } from "zod";
import { SPEND_CATEGORIES } from "@/engine/cards/types";
import { countryCode, currencyCode, dollarAmount } from "./primitives";

// JSON imports contain numbers, while browser form controls submit their values as
// strings. Keeping that coercion here means both entry points share the same
// validation contract; importantly, blank strings are not quietly treated as 0.
const numericInput = z
  .union([z.number(), z.string().trim().min(1)])
  .transform((value, ctx) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({ code: "custom", message: "Must be a number" });
      return z.NEVER;
    }
    return parsed;
  });

export const cardRewardsInput = z.object({
  pointValueCents: numericInput.pipe(z.number().positive().max(10)),
  fxFeePct: numericInput.pipe(z.number().min(0).max(5)),
  baseMultiplier: numericInput.pipe(z.number().min(0).max(10)),
  categoryRates: z.array(
    z
      .object({
        category: z.enum(SPEND_CATEGORIES),
        multiplier: numericInput.pipe(z.number().positive().max(20)),
        cap: dollarAmount({ min: 1 }).optional(),
        capWindow: z.enum(["MONTH", "YEAR"]).optional(),
      })
      .refine((r) => (r.cap === undefined) === (r.capWindow === undefined), {
        message: "cap and capWindow must be set together",
      })
      .transform(({ cap, ...rest }) => ({ ...rest, capMinor: cap })),
  ),
  credits: z
    .array(
      z
        .object({
          id: z.string().trim().min(1).max(40),
          label: z.string().trim().min(1).max(80),
          value: dollarAmount({ min: 1 }),
          period: z.enum(["YEAR", "MONTH"]),
        })
        .transform(({ value, ...rest }) => ({ ...rest, valueMinor: value })),
    )
    .default([]),
});

export const cardImportEntry = z
  .object({
  nickname: z.string().trim().min(1).max(60),
  issuer: z.string().trim().min(1).max(60),
  network: z.enum(["VISA", "MASTERCARD", "AMEX"]),
  lastFour: z.string().regex(/^\d{4}$/).optional(),
  country: countryCode.default("CA"),
  currency: currencyCode.default("CAD"),
  limit: dollarAmount({ min: 1 }).optional(),
  statementDay: z.coerce.number().int().min(1).max(28).optional(),
  dueDay: z.coerce.number().int().min(1).max(28).optional(),
  aprPct: z.coerce.number().min(0).max(50).optional(),
  annualFee: dollarAmount({ min: 0 }).default(0),
  rewards: cardRewardsInput,
}).transform(({ limit, annualFee, ...rest }) => ({
  ...rest,
  limitMinor: limit,
  annualFeeMinor: annualFee,
}));
