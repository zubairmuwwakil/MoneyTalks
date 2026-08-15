import { z } from "zod";
import { currencyCode, formBoolean, isoDate, minorUnits } from "./primitives";

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
    amountMinor: minorUnits.positive(),
    note: optional(z.string().trim().max(200)),
  })
  .refine((s) => s.to === undefined || s.from <= s.to, { message: "from must be <= to" });

export const billCore = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.enum(["housing", "utilities", "subscriptions", "transport", "debt", "other"]),
  payee: optional(z.string().trim().max(80)),
  currency: currencyCode.default("CAD"),
  autopay: formBoolean,
  variable: formBoolean,
  notes: optional(z.string().trim().max(500)),
  prepaymentMonthDay: optional(z.string().regex(/^\d{2}-\d{2}$/, "MM-DD, e.g. 03-15")),
  interestRatePct: optional(z.coerce.number().positive().max(30)),
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
