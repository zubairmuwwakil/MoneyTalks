import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/require-user";
import { PaymentsCanadaError, searchCorporateCreditors } from "@/lib/services/paymentsCanada";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json({ billers: [] });
  if (query.length > 80) return NextResponse.json({ error: "Search is too long." }, { status: 400 });

  try {
    const billers = await searchCorporateCreditors(query);
    return NextResponse.json({ billers });
  } catch (error) {
    const unavailable = error instanceof PaymentsCanadaError;
    return NextResponse.json(
      { error: unavailable ? "Verified biller search is temporarily unavailable." : "Biller search failed." },
      { status: 502 },
    );
  }
}
