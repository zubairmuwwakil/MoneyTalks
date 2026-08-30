import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

export const runtime = "nodejs";

type StoredReason = { code?: unknown; detail?: unknown };

function readableReasons(value: unknown): Array<{ code: string | null; detail: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return [];
    const reason = candidate as StoredReason;
    if (typeof reason.detail !== "string" || !reason.detail.trim()) return [];
    return [{
      code: typeof reason.code === "string" ? reason.code : null,
      detail: reason.detail.trim(),
    }];
  });
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const rows = await prisma.recurringObligation.findMany({
    where: { userId, origin: "DETECTED", needsReview: true },
    include: {
      evidence: { orderBy: { occurredAt: "asc" } },
    },
    orderBy: [{ confidence: "desc" }, { lastObservedAt: "desc" }],
    take: 200,
  });

  return NextResponse.json({
    obligations: rows.map(({ confidenceReasons, ...obligation }) => ({
      ...obligation,
      reasons: readableReasons(confidenceReasons),
    })),
  });
}
