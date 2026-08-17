import { type NextRequest, NextResponse } from "next/server";
import { sweepPurchaseDuplicateFlags } from "@/lib/domain/spine/purchaseMergeSweep";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";

export const runtime = "nodejs";

async function runPurchaseMergeCron(req: NextRequest) {
  if (!(await isAuthorizedCronRequest(req))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const result = await sweepPurchaseDuplicateFlags();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) {
  return runPurchaseMergeCron(req);
}

export async function POST(req: NextRequest) {
  return runPurchaseMergeCron(req);
}
