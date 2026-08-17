import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { ownerStateInput } from "@/lib/validation/owner-state";

export const dynamic = "force-dynamic";

/// Replaces the user-authored wallet configuration. Cap usage remains in its separate ledger,
/// so a setup edit cannot erase observed spend that wallet capture has already recorded.
export async function PUT(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = ownerStateInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid owner state" }, { status: 400 });

  const record = await prisma.ownerStateRecord.upsert({
    where: { userId },
    create: { userId, stateData: parsed.data as unknown as Prisma.InputJsonValue },
    update: { stateData: parsed.data as unknown as Prisma.InputJsonValue },
    select: { stateData: true, updatedAt: true },
  });
  return NextResponse.json({ ownerState: record.stateData, updatedAt: record.updatedAt.toISOString() });
}
