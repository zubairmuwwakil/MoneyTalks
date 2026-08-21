import { z } from "zod";
import { countryCode, currencyCode, dollarAmount } from "./primitives";

const emptyToUndefined = (val: unknown) =>
  typeof val === "string" && val.trim() === "" ? undefined : val;

// JSON imports contain numbers, while browser form controls submit their values as
// strings. Keeping that coercion here means both entry points share the same
// validation contract; importantly, blank strings are not quietly treated as 0.
export const cardImportEntry = z
  .object({
    nickname: z.string().trim().min(1).max(60),
    issuer: z.string().trim().min(1).max(60),
    network: z.enum(["VISA", "MASTERCARD", "AMEX"]),
    lastFour: z.preprocess(emptyToUndefined, z.string().regex(/^\d{4}$/).optional()),
    country: countryCode.default("CA"),
    currency: currencyCode.default("CAD"),
    limit: z.preprocess(emptyToUndefined, dollarAmount({ min: 1 }).optional()),
    statementDay: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(28).optional()),
    dueDay: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(28).optional()),
    aprPct: z.preprocess(emptyToUndefined, z.coerce.number().min(0).max(50).optional()),
    annualFee: z.preprocess(emptyToUndefined, dollarAmount({ min: 0 }).default(0)),
    // Recurring month-day the annual fee posts on. Unlike statementDay/dueDay
    // (capped at 28 because issuers set those themselves), this is a real
    // anniversary — a card opened on Mar 31 renews on Mar 31 — so days 29-31 are
    // accepted and resolved against the actual month by clampDayToMonth at read
    // time. See src/lib/cards/feeSchedule.ts.
    feeMonthDay: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Use MM-DD, e.g. 03-15")
        .nullish(),
    ),
    feeCancelGraceDays: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(0).max(180).default(30),
    ),
    // The catalogue card this is a copy of. Optional because a legacy row, or an
    // import that cannot know which product it holds, is a real state — the card
    // still works, it simply has no rates until the owner links it. Guessing the
    // link instead would silently rescore their spend against the wrong card.
    contractCardId: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(100).nullish()),
    // What the owner's banking package actually rebates off the fee. Their own
    // arrangement, not a property of the card: issuers offer tiers, so only the
    // owner can say which one they hold.
    feeRebate: z.preprocess(emptyToUndefined, dollarAmount({ min: 0 }).default(0)),
  })
  .superRefine((entry, ctx) => {
    if (entry.feeRebate > entry.annualFee) {
      ctx.addIssue({
        code: "custom",
        path: ["feeRebate"],
        message: "A fee rebate cannot exceed the card's annual fee",
      });
    }
  })
  .transform(({ limit, annualFee, feeRebate, ...rest }) => ({
    ...rest,
    limitMinor: limit,
    annualFeeMinor: annualFee,
    feeRebateMinor: feeRebate,
  }));
