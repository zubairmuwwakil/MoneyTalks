import { type NextRequest, NextResponse } from "next/server";
import { sweepPurchaseDuplicateFlags } from "@/lib/domain/spine/purchaseMergeSweep";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";
import { sendServiceFailureAlert } from "@/lib/services/alerting";

export const runtime = "nodejs";

async function runPurchaseMergeCron(req: NextRequest) {
  if (!(await isAuthorizedCronRequest(req))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const result = await sweepPurchaseDuplicateFlags();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await sendServiceFailureAlert({
      serviceName: "cron/purchase-merge",
      summary: "Unhandled error during purchase merge sweep",
      error,
    });
    return NextResponse.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return runPurchaseMergeCron(req);
}

export async function POST(req: NextRequest) {
  return runPurchaseMergeCron(req);
}

