import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { scheduleNextDigestJob, cancelPendingDigestJobs } from "@/lib/domain/notifications/digestJobScheduler";

export const runtime = "nodejs";

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  // Ensure a row exists; populate primaryEmail from Clerk if missing.
  const pref = await prisma.notificationPreference.upsert({
    where: { userId },
    create: {
      userId,
    },
    update: {},
  });

  return NextResponse.json({ preference: pref });
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const digest = Boolean(body.emailDigestEnabled ?? false);
  const digestHourLocal = clamp(Number(body.digestHourLocal ?? 9), 0, 23);
  const timezone = typeof body.timezone === "string" && body.timezone.length > 0 ? body.timezone : "America/Toronto";
  const subLeadDays = clamp(Number(body.subLeadDays ?? 3), 0, 31);
  const returnLeadDays = clamp(Number(body.returnLeadDays ?? 2), 0, 31);
  const billLeadDays = clamp(Number(body.billLeadDays ?? 2), 0, 31);
  const primaryEmail = typeof body.primaryEmail === "string" && body.primaryEmail.length > 0 ? body.primaryEmail : null;
  const notifyOnDelivery = Boolean(body.notifyOnDelivery ?? true);
  const notifyOnRefundOverdue = Boolean(body.notifyOnRefundOverdue ?? true);

  const updated = await prisma.notificationPreference.upsert({
    where: { userId },
    create: {
      userId,
      emailDigestEnabled: digest,
      digestHourLocal,
      timezone,
      subLeadDays,
      returnLeadDays,
      billLeadDays,
      primaryEmail,
      notifyOnDelivery,
      notifyOnRefundOverdue,
    },
    update: {
      emailDigestEnabled: digest,
      digestHourLocal,
      timezone,
      subLeadDays,
      returnLeadDays,
      billLeadDays,
      primaryEmail,
      notifyOnDelivery,
      notifyOnRefundOverdue,
    },
  });

  // Schedule or cancel digest jobs based on enabled state
  if (digest) {
    await scheduleNextDigestJob(userId, { timezone, digestHourLocal });
  } else {
    await cancelPendingDigestJobs(userId);
  }

  return NextResponse.json({ preference: updated });
}
