import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchCadRates, SUPPORTED_FX_CURRENCIES } from "@/lib/fetch-fx";
import { syncFxRates } from "@/lib/domain/fx/fxSync";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";

export const runtime = "nodejs";

async function runFxCron(req: NextRequest) {
  if (!(await isAuthorizedCronRequest(req))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const rates = await fetchCadRates(SUPPORTED_FX_CURRENCIES);

  // Foreign spend cannot accrue to the CAD cap ledger without a rate on file,
  // so an empty fetch is a real gap and must be visible, not a silent 200.
  if (rates.length === 0) {
    console.warn("[cron/fx] Bank of Canada returned no usable rates; existing rates left untouched");
    return NextResponse.json({ ok: false, reason: "no-rates-available", written: 0 }, { status: 502 });
  }

  const written = await syncFxRates(prisma, rates);

  return NextResponse.json({
    ok: true,
    written,
    asOf: rates[0]?.asOf ?? null,
    currencies: rates.map((rate) => rate.base),
  });
}

export async function GET(req: NextRequest) {
  return runFxCron(req);
}

export async function POST(req: NextRequest) {
  return runFxCron(req);
}
