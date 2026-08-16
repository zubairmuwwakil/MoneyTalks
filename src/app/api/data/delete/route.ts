import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const job = await prisma.dataDeletionJob.create({
    data: { userId, status: "RUNNING" },
  });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.notificationJob.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.notificationPreference.deleteMany({ where: { userId } });
      await tx.snoozedEvent.deleteMany({ where: { userId } });

      // The merged foreign keys cascade return children and purchase children.
      await tx.returnItem.deleteMany({ where: { userId } });
      await tx.subscriptionPayment.deleteMany({ where: { userId } });
      await tx.subscription.deleteMany({ where: { userId } });
      await tx.purchase.deleteMany({ where: { userId } });
      await tx.emailTransaction.deleteMany({ where: { userId } });
      await tx.receiptUpload.deleteMany({ where: { userId } });

      await tx.automationSuggestion.deleteMany({ where: { userId } });
      await tx.detectedItem.deleteMany({ where: { userId } });
      await tx.valueEvent.deleteMany({ where: { userId } });
      await tx.emailConnection.deleteMany({ where: { userId } });
    });

    await prisma.dataDeletionJob.update({
      where: { id: job.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    return NextResponse.json({ ok: true, jobId: job.id });
  } catch (error) {
    await prisma.dataDeletionJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: error instanceof Error ? error.message : String(error) },
    });

    return NextResponse.json({ error: "Failed to delete data" }, { status: 500 });
  }
}
