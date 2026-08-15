import { z } from "zod";
import { SPEND_CATEGORIES } from "@/engine/cards/types";
import { countryCode, currencyCode, minorUnits } from "./primitives";

const positiveMinor = minorUnits.nonnegative();

export const cardRewardsInput = z.object({
  pointValueCents: z.number().positive().max(10),
  fxFeePct: z.number().min(0).max(5),
  baseMultiplier: z.number().min(0).max(10),
  categoryRates: z.array(
    z
      .object({
        category: z.enum(SPEND_CATEGORIES),
        multiplier: z.number().positive().max(20),
        capMinor: positiveMinor.positive().optional(),
        capWindow: z.enum(["MONTH", "YEAR"]).optional(),
      })
      .refine((r) => (r.capMinor === undefined) === (r.capWindow === undefined), {
        message: "capMinor and capWindow must be set together",
      }),
  ),
  credits: z.array(
    z.object({
      id: z.string().trim().min(1).max(40),
      label: z.string().trim().min(1).max(80),
      valueMinor: positiveMinor.positive(),
      period: z.enum(["YEAR", "MONTH"]),
    }),
  ),
});

export const cardImportEntry = z.object({
  nickname: z.string().trim().min(1).max(60),
  issuer: z.string().trim().min(1).max(60),
  network: z.enum(["VISA", "MASTERCARD", "AMEX"]),
  lastFour: z.string().regex(/^\d{4}$/).optional(),
  country: countryCode.default("CA"),
  currency: currencyCode.default("CAD"),
  limitMinor: positiveMinor.positive().optional(),
  statementDay: z.coerce.number().int().min(1).max(28).optional(),
  dueDay: z.coerce.number().int().min(1).max(28).optional(),
  aprPct: z.coerce.number().min(0).max(50).optional(),
  annualFeeMinor: positiveMinor.default(0),
  rewards: cardRewardsInput,
});
