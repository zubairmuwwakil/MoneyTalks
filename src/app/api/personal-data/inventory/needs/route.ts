import { type NextRequest, NextResponse } from "next/server";

import { isAuthorizedPersonalDataRequest } from "@/lib/personal-data/inventory/auth";
import { listInventoryNeeds } from "@/lib/personal-data/inventory/domain";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAuthorizedPersonalDataRequest(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const needs = await listInventoryNeeds();
  return NextResponse.json({ needs });
}
