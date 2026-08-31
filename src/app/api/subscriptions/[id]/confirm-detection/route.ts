import { NextResponse } from "next/server";
import { recordLegacySubscriptionAdapterRequest } from "@/lib/observability";
import { getSessionUserId } from "@/lib/require-user";

export const runtime = "nodejs";

const headers = { Deprecation: "true", Link: '</api/recurring>; rel="successor-version"' };

export async function POST(request?: Request) {
  recordLegacySubscriptionAdapterRequest({
    request,
    route: "confirm-detection",
    method: "POST",
  });
  const userId = await getSessionUserId();
  const response = !userId
    ? new NextResponse("Unauthorized", { status: 401, headers })
    : NextResponse.json(
    { error: "confirm-detection is retired; use /api/recurring evidence review instead." },
    { status: 410, headers },
  );
  return response;
}
