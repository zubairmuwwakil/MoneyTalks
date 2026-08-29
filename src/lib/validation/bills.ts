import { z } from "zod";
import { currencyCode, dollarAmount, formBoolean, isoDate } from "./primitives";

/**
 * Blank optional inputs: an empty <input type="date"> or text field submits ""
 * rather than omitting the key, and "" is not a valid ISO date. Treat it as
 * absent so an open-ended schedule entry ("to" left blank) is addable from the
 * UI at all.
 */
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}

export const cadenceInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("BIWEEKLY"), anchor: isoDate }),
  z.object({
    type: z.literal("MONTHLY"),
    dayOfMonth: z.coerce.number().int().min(1).max(31),
    startsFrom: optional(isoDate),
    activeMonths: z.array(z.number().int().min(1).max(12)).nonempty().optional(),
  }),
  z.object({ type: z.literal("QUARTERLY"), anchor: isoDate }),
  z.object({ type: z.literal("ANNUAL"), anchor: isoDate }),
]);

export const scheduleEntryInput = z
  .object({
    from: isoDate,
    to: optional(isoDate),
    amount: dollarAmount({ min: 1 }),
    note: optional(z.string().trim().max(200)),
  })
  .refine((s) => s.to === undefined || s.from <= s.to, { message: "from must be <= to" })
  .transform(({ amount, ...rest }) => ({ ...rest, amountMinor: amount }));

export const billCore = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.enum(["housing", "utilities", "subscriptions", "transport", "debt", "other"]),
  payee: optional(z.string().trim().max(80)),
  accountNumber: optional(z.string().trim().max(80)),
  currency: currencyCode.default("CAD"),
  autopay: formBoolean,
  variable: formBoolean,
  notes: optional(z.string().trim().max(500)),
  prepaymentMonthDay: optional(z.string().regex(/^\d{2}-\d{2}$/, "MM-DD, e.g. 03-15")),
  interestRatePct: optional(z.coerce.number().positive().max(30)),
  // Pinned engine spend category (e.g. "streaming") — an explicit override
  // of the derived Bill.category mapping. Only loosely shaped here (a
  // non-empty string); membership in the catalogue's real vocabulary is
  // checked against `billSpendCategoryOptions` where the catalogue is in
  // scope (src/app/bills/actions.ts), not here — this module stays engine-
  // agnostic, matching its existing "field-level validators" scope.
  spendCategory: optional(z.string().trim().min(1).max(80)),
  // How the bill can actually be paid — see resolveBillPaymentRail
  // (src/lib/domain/bills/cardForBill.ts). "unknown" is the default so an
  // unrecorded rail keeps deferring to the Bill.category assumption.
  paymentRail: z.enum(["unknown", "card", "pad", "card_via_third_party"]).default("unknown"),
  // Third-party pass-through surcharge, as a percentage (2.5 = 2.5%). Left
  // deliberately UNCOUPLED from paymentRail here: a fee recorded against a
  // non-third-party rail is inert (the domain layer only reads it for
  // card_via_third_party), and a cross-field refine would turn billCore into
  // a ZodEffects that `billImportEntry`/`investments.ts` can no longer
  // `.extend()`. The consequential case — a third-party rail with NO fee —
  // is enforced where it matters, by blocking the recommendation outright.
  railFeePct: optional(z.coerce.number().min(0).max(100)),
});

export const billImportEntry = billCore.extend({
  cadence: cadenceInput,
  schedule: z.array(scheduleEntryInput).min(1),
});

function jsonField<T extends z.ZodType>(schema: T, label: string) {
  return z.string().transform((raw, ctx) => {
    const parsed = (() => {
      try {
        return schema.safeParse(JSON.parse(raw));
      } catch {
        return null;
      }
    })();
    if (!parsed?.success) {
      ctx.addIssue({ code: "custom", message: `invalid ${label} JSON` });
      return z.NEVER;
    }
    return parsed.data;
  });
}

// Form variant: cadence + schedule arrive as JSON strings from hidden fields
export const billFormInput = billCore.extend({
  cadenceJson: jsonField(cadenceInput, "cadence"),
  scheduleJson: jsonField(z.array(scheduleEntryInput).min(1), "schedule"),
});

export type BillImportEntry = z.infer<typeof billImportEntry>;
export type CadenceInput = z.infer<typeof cadenceInput>;
export type ScheduleEntryInput = z.infer<typeof scheduleEntryInput>;
