import { z } from "zod";
import { parseDollarsToMinor } from "@/engine/money";

// Profile amount columns are Prisma `Int` (32-bit), same as every other money column
// in the schema — bound the inputs to that range so an oversized entry is a field
// error rather than a Postgres write failure.
//
// The form boundary takes DOLLARS ("1,234.56") and stores CENTS, matching every other
// money field in the app (integer minor units in storage and in engines). `minFloor`
// lets a field require a strictly-positive amount (income sources) while every other
// field allows zero.
function dollarsToMinor(minFloor: 0 | 1 = 0) {
  // Bounds are checked in CENTS (post-transform), but the user typed DOLLARS — so the
  // messages must be phrased in dollars too, or a Zod default ("expected number to be
  // <=2147483647") reads as dollars next to a "($)" label and misleads by 100x.
  const floorMessage = minFloor === 0 ? "Must be $0.00 or more" : "Must be more than $0.00";
  const ceilingMessage = "Must be $21,474,836.47 or less";
  return z
    .string()
    .transform((raw, ctx) => {
      const minor = parseDollarsToMinor(raw);
      if (minor === null) {
        ctx.addIssue({ code: "custom", message: "Must be a dollar amount, e.g. 1234.56" });
        return z.NEVER;
      }
      return minor;
    })
    .pipe(z.number().int().min(minFloor, floorMessage).max(2_147_483_647, ceilingMessage));
}

const dollarsMinor = dollarsToMinor(0);

// An unchecked checkbox submits nothing at all, so the default carries the "false" case.
const formBoolean = z
  .union([z.boolean(), z.literal("true"), z.literal("false")])
  .transform((value) => value === true || value === "true")
  .default(false);

export const incomeSourceInput = z.object({
  name: z.string().trim().min(1).max(60),
  amountMinor: dollarsToMinor(1),
  cadence: z.enum(["MONTHLY", "BIWEEKLY", "ANNUAL"]),
  kind: z.enum(["EMPLOYMENT", "SELF_EMPLOYMENT", "BENEFIT", "RENTAL", "OTHER"]),
});

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
  rdspGrantsLifetimeMinor: dollarsMinor,
  rdspContribLifetimeMinor: dollarsMinor,
  tfsaRoomMinor: dollarsMinor,
  rrspRoomMinor: dollarsMinor,
  fhsaRoomMinor: dollarsMinor,
  cushionMinor: dollarsMinor,
  nhtContributed: formBoolean,
});
