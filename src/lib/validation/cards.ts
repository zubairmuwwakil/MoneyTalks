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

const shortId = z.string().trim().min(1).max(40);
const optionalId = shortId.optional();

const categoryRateInput = z
  .object({
    category: z.enum(SPEND_CATEGORIES),
    multiplier: numericInput.pipe(z.number().positive().max(20)),
    cap: dollarAmount({ min: 1 }).optional(),
    capWindow: z.enum(["MONTH", "YEAR"]).optional(),
    capGroupId: optionalId,
    requiresConditionId: optionalId,
  })
  .refine((rate) => (rate.cap === undefined) === (rate.capWindow === undefined), {
    message: "cap and capWindow must be set together",
  })
  .refine((rate) => rate.capGroupId === undefined || rate.cap === undefined, {
    message: "Use either a category cap or a shared cap group, not both",
  })
  .transform(({ cap, ...rest }) => ({ ...rest, capMinor: cap }));

const capGroupInput = z
  .object({
    id: shortId,
    label: z.string().trim().min(1).max(80),
    cap: dollarAmount({ min: 1 }),
    capWindow: z.enum(["MONTH", "YEAR"]),
  })
  .transform(({ cap, ...rest }) => ({ ...rest, capMinor: cap }));

const conditionInput = z
  .object({
    id: shortId,
    label: z.string().trim().min(1).max(100),
    enabled: z.boolean(),
    annualFeeReduction: dollarAmount({ min: 1 }).optional(),
  })
  .transform(({ annualFeeReduction, ...rest }) => ({ ...rest, annualFeeReductionMinor: annualFeeReduction }));

const merchantRateInput = z.object({
  id: shortId,
  merchant: z.string().trim().min(1).max(80),
  multiplier: numericInput.pipe(z.number().positive().max(20)),
  requiresConditionId: optionalId,
});

export const cardRewardsInput = z
  .object({
    pointValueCents: numericInput.pipe(z.number().positive().max(10)),
    fxFeePct: numericInput.pipe(z.number().min(0).max(5)),
    baseMultiplier: numericInput.pipe(z.number().min(0).max(10)),
    categoryRates: z.array(categoryRateInput),
    credits: z
      .array(
        z
          .object({
            id: shortId,
            label: z.string().trim().min(1).max(80),
            value: dollarAmount({ min: 1 }),
            period: z.enum(["YEAR", "MONTH"]),
          })
          .transform(({ value, ...rest }) => ({ ...rest, valueMinor: value })),
      )
      .default([]),
    capGroups: z.array(capGroupInput).default([]),
    conditions: z.array(conditionInput).default([]),
    merchantRates: z.array(merchantRateInput).default([]),
  })
  .superRefine((rewards, ctx) => {
    const duplicate = (values: string[]) => values.find((value, index) => values.indexOf(value) !== index);
    const duplicateCategory = duplicate(rewards.categoryRates.map((rate) => rate.category));
    if (duplicateCategory) {
      ctx.addIssue({ code: "custom", path: ["categoryRates"], message: "Each bonus category can only be added once" });
    }

    const capGroupIds = new Set(rewards.capGroups.map((group) => group.id));
    const conditionIds = new Set(rewards.conditions.map((condition) => condition.id));
    if (duplicate(rewards.capGroups.map((group) => group.id))) {
      ctx.addIssue({ code: "custom", path: ["capGroups"], message: "Shared cap IDs must be unique" });
    }
    if (duplicate(rewards.conditions.map((condition) => condition.id))) {
      ctx.addIssue({ code: "custom", path: ["conditions"], message: "Condition IDs must be unique" });
    }
    if (duplicate(rewards.merchantRates.map((rate) => rate.id))) {
      ctx.addIssue({ code: "custom", path: ["merchantRates"], message: "Merchant bonus IDs must be unique" });
    }

    rewards.categoryRates.forEach((rate, index) => {
      if (rate.capGroupId && !capGroupIds.has(rate.capGroupId)) {
        ctx.addIssue({ code: "custom", path: ["categoryRates", index, "capGroupId"], message: "Choose an existing shared cap" });
      }
      if (rate.requiresConditionId && !conditionIds.has(rate.requiresConditionId)) {
        ctx.addIssue({ code: "custom", path: ["categoryRates", index, "requiresConditionId"], message: "Choose an existing condition" });
      }
    });
    rewards.merchantRates.forEach((rate, index) => {
      if (rate.requiresConditionId && !conditionIds.has(rate.requiresConditionId)) {
        ctx.addIssue({ code: "custom", path: ["merchantRates", index, "requiresConditionId"], message: "Choose an existing condition" });
      }
    });
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
})
  .superRefine((entry, ctx) => {
    const totalReduction = entry.rewards.conditions.reduce(
      (sum, condition) => sum + (condition.annualFeeReductionMinor ?? 0),
      0,
    );
    if (totalReduction > entry.annualFee) {
      ctx.addIssue({
        code: "custom",
        path: ["rewards", "conditions"],
        message: "Annual-fee reductions cannot exceed the card's published annual fee",
      });
    }
  })
  .transform(({ limit, annualFee, ...rest }) => ({
    ...rest,
    limitMinor: limit,
    annualFeeMinor: annualFee,
  }));
