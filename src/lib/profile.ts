import type { IncomeSource, ProfileView } from "@/engine/rules/types";
import { prisma } from "@/lib/prisma";

export async function getOrCreateProfile(userId: string): Promise<ProfileView> {
  const row =
    (await prisma.profile.findUnique({ where: { userId } })) ??
    (await prisma.profile.create({ data: { userId } }));

  return {
    residency: row.residency,
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
