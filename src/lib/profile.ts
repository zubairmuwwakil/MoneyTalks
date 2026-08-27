import type { IncomeSource, ProfileView } from "@/engine/rules/types";
import { prisma } from "@/lib/prisma";

export type OwnerProfile = ProfileView & { cardShoppingMarket: "CA" | "US" };

export async function getOrCreateProfile(userId: string): Promise<OwnerProfile> {
  const row =
    (await prisma.profile.findUnique({ where: { userId } })) ??
    (await prisma.profile.create({ data: { userId } }));

  return {
    residency: row.residency,
    // A bad legacy value must fail closed to the established Canadian default,
    // never make a foreign catalogue appear unexpectedly.
    cardShoppingMarket: row.cardShoppingMarket === "US" ? "US" : "CA",
    citizenships: row.citizenships,
    filingStatus: (["SINGLE_ABROAD", "MFJ_ABROAD", "OTHER"] as const).includes(
      row.filingStatus as never,
    )
      ? (row.filingStatus as ProfileView["filingStatus"])
      : "OTHER",
    marginalUSRatePct: row.marginalUSRatePct,
    dtcEligible: row.dtcEligible,
    benefitPrograms: row.benefitPrograms,
    rdspIncomeTier: (["LOW", "HIGH", "UNKNOWN"] as const).includes(row.rdspIncomeTier as never)
      ? (row.rdspIncomeTier as ProfileView["rdspIncomeTier"])
      : "UNKNOWN",
    rdspCarryForwardYears: row.rdspCarryForwardYears,
    rdspGrantsLifetimeMinor: row.rdspGrantsLifetimeMinor,
    rdspContribLifetimeMinor: row.rdspContribLifetimeMinor,
    tfsaRoomMinor: row.tfsaRoomMinor,
    rrspRoomMinor: row.rrspRoomMinor,
    fhsaRoomMinor: row.fhsaRoomMinor,
    cushionMinor: row.cushionMinor,
    nhtContributed: row.nhtContributed,
    incomeSources: (row.incomeSources as IncomeSource[] | null) ?? [],
  };
}
