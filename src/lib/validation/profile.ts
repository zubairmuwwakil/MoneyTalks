import { z } from "zod";

const PRISMA_INT_MAX = 2_147_483_647;

// Profile amount columns are Prisma `Int` (32-bit), same as every other money column
// in the schema — bound the inputs to that range so an oversized entry is a field
// error rather than a Postgres write failure.
const minorUnits = z.number().int().min(0).max(PRISMA_INT_MAX);

const dollarAmount = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const raw = String(value).trim();
  const match = raw.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) {
    ctx.addIssue({
      code: "custom",
      message: "Enter a dollar amount with up to 2 decimal places",
    });
    return z.NEVER;
  }

  const dollars = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  const amountMinor = dollars * 100 + cents;
  if (!Number.isSafeInteger(amountMinor) || amountMinor > PRISMA_INT_MAX) {
    ctx.addIssue({
      code: "custom",
      message: "Amount is too large",
    });
    return z.NEVER;
  }

  return amountMinor;
}).pipe(minorUnits);

// An unchecked checkbox submits nothing at all, so the default carries the "false" case.
const formBoolean = z
  .union([z.boolean(), z.literal("true"), z.literal("false")])
  .transform((value) => value === true || value === "true")
  .default(false);

export const incomeSourceInput = z.object({
  name: z.string().trim().min(1).max(60),
  amount: dollarAmount.pipe(minorUnits.positive()),
  cadence: z.enum(["MONTHLY", "BIWEEKLY", "ANNUAL"]),
  kind: z.enum(["EMPLOYMENT", "SELF_EMPLOYMENT", "BENEFIT", "RENTAL", "OTHER"]),
}).transform(({ amount, ...data }) => ({ ...data, amountMinor: amount }));

export const profileInput = z.object({
  residency: z.string().regex(/^[A-Z]{2}$/),
  citizenships: z.string().trim().transform((s) =>
    s.split(",").map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)),
  ),
  filingStatus: z.enum(["SINGLE_ABROAD", "MFJ_ABROAD", "OTHER"]),
  marginalUSRatePct: z.coerce.number().int().min(0).max(50),
  dtcEligible: formBoolean,
  benefitPrograms: z.string().trim().transform((s) =>
    s.split(",").map((p) => p.trim().toUpperCase()).filter((p) => ["OW", "ODSP"].includes(p)),
  ),
  rdspIncomeTier: z.enum(["LOW", "HIGH", "UNKNOWN"]),
  rdspCarryForwardYears: z.coerce.number().int().min(0).max(20),
  rdspGrantsLifetime: dollarAmount,
  rdspContribLifetime: dollarAmount,
  tfsaRoom: dollarAmount,
  rrspRoom: dollarAmount,
  fhsaRoom: dollarAmount,
  nhtContributed: formBoolean,
}).transform(
  ({
    rdspGrantsLifetime,
    rdspContribLifetime,
    tfsaRoom,
    rrspRoom,
    fhsaRoom,
    ...data
  }) => ({
    ...data,
    rdspGrantsLifetimeMinor: rdspGrantsLifetime,
    rdspContribLifetimeMinor: rdspContribLifetime,
    tfsaRoomMinor: tfsaRoom,
    rrspRoomMinor: rrspRoom,
    fhsaRoomMinor: fhsaRoom,
  }),
);
