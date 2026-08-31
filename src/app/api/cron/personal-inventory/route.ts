import { type NextRequest, NextResponse } from "next/server";

import { processPersonalInventoryOutbox } from "@/lib/personal-data/inventory/outbox";
import { reconcileNotionInventory } from "@/lib/personal-data/inventory/sync";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";
import { sendServiceFailureAlert } from "@/lib/services/alerting";

export const runtime = "nodejs";
export const maxDuration = 120;

async function run(req: NextRequest) {
  if (!(await isAuthorizedCronRequest(req))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    // Flush Postgres-authoritative writes first, then read Notion back. That
    // ordering makes the reconciliation pass a consistency check instead of
    // racing our own projection.
    const outbox = await processPersonalInventoryOutbox(25);
    const reconciliation = await reconcileNotionInventory();

    if (outbox.failed > 0) {
      await sendServiceFailureAlert({
        serviceName: "cron/personal-inventory",
        summary: `Personal inventory outbox has ${outbox.failed} failed item(s)`,
        details: outbox,
      });
    }

    return NextResponse.json({
      ok: true,
      outbox,
      reconciliation,
    });
  } catch (error) {
    await sendServiceFailureAlert({
      serviceName: "cron/personal-inventory",
      summary: "Personal inventory synchronization failed",
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
