import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COMMUNITY_MCC_RETENTION_DAYS } from "@/lib/community-merchant-mcc";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";
import { sendServiceFailureAlert } from "@/lib/services/alerting";

export const runtime = "nodejs";
export const maxDuration = 120;

async function run(req: NextRequest) {
  if (!(await isAuthorizedCronRequest(req))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const cutoff = new Date(Date.now() - COMMUNITY_MCC_RETENTION_DAYS * 86_400_000);
    const result = await prisma.communityMerchantMCCObservation.deleteMany({
      where: { observedAt: { lt: cutoff } },
    });
    return NextResponse.json({ ok: true, deleted: result.count });
  } catch (error) {
    await sendServiceFailureAlert({
      serviceName: "cron/community-merchant-mcc-retention",
      summary: "Unable to delete expired community merchant MCC observations",
      error,
    });
    return NextResponse.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
