import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { currentCapProgress } from "@/lib/spine/current-cap-progress";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("unauthorized", { status: 401 });

  const ownerState = await prisma.ownerStateRecord.findUnique({
    where: { userId },
    select: { stateData: true },
  });

  const ledgerRows = await prisma.capUsageLedger.findMany({ where: { userId } });
  return NextResponse.json({
    // Seeded progress is only a migration baseline; a matching current ledger
    // row is real observed use and wins even when the seed had no cap value.
    caps: ownerState ? currentCapProgress(ownerState.stateData, new Date(), undefined, ledgerRows) : {},
  });
}
