import { NextResponse } from "next/server";
import { computeValueSummary } from "@/lib/domain/valueSummary";
import { getSessionUserId } from "@/lib/require-user";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  try {
    return NextResponse.json(await computeValueSummary(userId, { horizonDays: 7 }));
  } catch (error) {
    console.error("analytics summary error", error);
    return NextResponse.json({ error: "Failed to compute summary" }, { status: 500 });
  }
}
