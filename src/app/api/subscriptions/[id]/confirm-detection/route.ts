import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";

export const runtime = "nodejs";

const headers = { Deprecation: "true", Link: '</api/recurring>; rel="successor-version"' };

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401, headers });
  return NextResponse.json(
    { error: "confirm-detection is retired; use /api/recurring evidence review instead." },
    { status: 410, headers },
  );
}
