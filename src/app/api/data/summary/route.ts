import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const [
    purchases,
    purchaseItems,
    purchaseAttachments,
    returns,
    subscriptions,
    subscriptionPayments,
    bills,
    emailConnections,
    emailTransactions,
    receiptUploads,
    receiptDocuments,
    detectedItems,
    automationSuggestions,
    notifications,
    notificationJobs,
    notificationPreferences,
    snoozedEvents,
    shipmentEvents,
    refundCases,
    valueEvents,
  ] = await Promise.all([
    prisma.purchase.count({ where: { userId } }),
    prisma.purchaseItem.count({ where: { purchase: { userId } } }),
    prisma.purchaseAttachment.count({ where: { purchase: { userId } } }),
    prisma.returnItem.count({ where: { userId } }),
    prisma.subscription.count({ where: { userId } }),
    prisma.subscriptionPayment.count({ where: { userId } }),
    prisma.bill.count({ where: { userId } }),
    prisma.emailConnection.count({ where: { userId } }),
    prisma.emailTransaction.count({ where: { userId } }),
    prisma.receiptUpload.count({ where: { userId } }),
    prisma.receiptDocument.count({ where: { userId } }),
    prisma.detectedItem.count({ where: { userId } }),
    prisma.automationSuggestion.count({ where: { userId } }),
    prisma.notification.count({ where: { userId } }),
    prisma.notificationJob.count({ where: { userId } }),
    prisma.notificationPreference.count({ where: { userId } }),
    prisma.snoozedEvent.count({ where: { userId } }),
    prisma.shipmentEvent.count({ where: { userId } }),
    prisma.refundCase.count({ where: { userId } }),
    prisma.valueEvent.count({ where: { userId } }),
  ]);

  return NextResponse.json({
    purchases,
    purchaseItems,
    purchaseAttachments,
    returns,
    subscriptions,
    subscriptionPayments,
    bills,
    emailConnections,
    emailTransactions,
    receiptUploads,
    receiptDocuments,
    detectedItems,
    automationSuggestions,
    notifications,
    notificationJobs,
    notificationPreferences,
    snoozedEvents,
    shipmentEvents,
    refundCases,
    valueEvents,
  });
}
