import { describe, expect, it } from "vitest";
import { incomeSourceInput, profileInput } from "./profile";

describe("profileInput", () => {
  it("converts dollar form fields to stored minor-unit profile columns", () => {
    const parsed = profileInput.safeParse({
      residency: "CA",
      citizenships: "US, CA",
      filingStatus: "SINGLE_ABROAD",
      marginalUSRatePct: "24",
      benefitPrograms: "ODSP",
      rdspIncomeTier: "LOW",
      rdspCarryForwardYears: "3",
      rdspGrantsLifetime: "1234.56",
      rdspContribLifetime: "2500",
      tfsaRoom: "7000.50",
      rrspRoom: "12345.67",
      fhsaRoom: "8000",
    });

    expect(parsed).toMatchObject({
      success: true,
      data: {
        rdspGrantsLifetimeMinor: 123456,
        rdspContribLifetimeMinor: 250000,
        tfsaRoomMinor: 700050,
        rrspRoomMinor: 1234567,
        fhsaRoomMinor: 800000,
      },
    });
  });
});

describe("incomeSourceInput", () => {
  it("converts a dollar amount form field to stored minor units", () => {
    expect(
      incomeSourceInput.safeParse({
        name: "Job",
        amount: "1234.56",
        cadence: "MONTHLY",
        kind: "EMPLOYMENT",
      }),
    ).toMatchObject({
      success: true,
      data: { amountMinor: 123456 },
    });
  });
});
