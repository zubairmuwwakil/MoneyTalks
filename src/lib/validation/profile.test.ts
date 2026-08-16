import { describe, expect, it } from "vitest";
import { incomeSourceInput, profileInput } from "./profile";

const validProfile = {
  residency: "CA",
  citizenships: "US, CA",
  filingStatus: "SINGLE_ABROAD",
  marginalUSRatePct: "24",
  dtcEligible: "false",
  benefitPrograms: "",
  rdspIncomeTier: "UNKNOWN",
  rdspCarryForwardYears: "0",
  rdspGrantsLifetimeMinor: "0",
  rdspContribLifetimeMinor: "0",
  tfsaRoomMinor: "0",
  rrspRoomMinor: "0",
  fhsaRoomMinor: "0",
  cushionMinor: "0",
  nhtContributed: "false",
};

describe("profileInput dollars-entry fields", () => {
  it("accepts a plain dollars string and stores integer cents", () => {
    const parsed = profileInput.safeParse({ ...validProfile, tfsaRoomMinor: "1,234.56" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.tfsaRoomMinor).toBe(123_456);
  });

  it("accepts the new cushion field as dollars", () => {
    const parsed = profileInput.safeParse({ ...validProfile, cushionMinor: "500" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.cushionMinor).toBe(50_000);
  });

  it("accepts zero for every migrated field", () => {
    const parsed = profileInput.safeParse(validProfile);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.rdspGrantsLifetimeMinor).toBe(0);
      expect(parsed.data.rdspContribLifetimeMinor).toBe(0);
      expect(parsed.data.tfsaRoomMinor).toBe(0);
      expect(parsed.data.rrspRoomMinor).toBe(0);
      expect(parsed.data.fhsaRoomMinor).toBe(0);
      expect(parsed.data.cushionMinor).toBe(0);
    }
  });

  it("rejects an unparseable dollars string as a field error, not a throw", () => {
    const parsed = profileInput.safeParse({ ...validProfile, tfsaRoomMinor: "not-a-number" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].path).toEqual(["tfsaRoomMinor"]);
  });

  it("rejects a value over the 32-bit bound as a field error, with a dollars-terms message", () => {
    const parsed = profileInput.safeParse({ ...validProfile, tfsaRoomMinor: "21474836.48" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      // Regression: the default Zod message quotes the CENTS ceiling ("<=2147483647")
      // next to a "($)" label, reading as dollars — must be phrased in dollars instead.
      expect(parsed.error.issues[0].message).toBe("Must be $21,474,836.47 or less");
    }
  });

  it("rejects a negative dollars amount", () => {
    const parsed = profileInput.safeParse({ ...validProfile, cushionMinor: "-1" });
    expect(parsed.success).toBe(false);
  });
});

describe("incomeSourceInput dollars-entry amount", () => {
  const base = { name: "Fixture Salary", cadence: "MONTHLY", kind: "EMPLOYMENT" };

  it("parses a dollars amount into positive integer cents", () => {
    const parsed = incomeSourceInput.safeParse({ ...base, amountMinor: "2,000.00" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.amountMinor).toBe(200_000);
  });

  it("rejects zero (must be positive)", () => {
    expect(incomeSourceInput.safeParse({ ...base, amountMinor: "0" }).success).toBe(false);
  });

  it("rejects an unparseable amount", () => {
    expect(incomeSourceInput.safeParse({ ...base, amountMinor: "abc" }).success).toBe(false);
  });
});
