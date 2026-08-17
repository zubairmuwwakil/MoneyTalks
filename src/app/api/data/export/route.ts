import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const [
    emailConnection,
    emailTransactions,
    receiptUploads,
    purchases,
    returns,
    subscriptions,
    subscriptionPayments,
    detectedItems,
    automationSuggestions,
    notifications,
    notificationPreference,
    snoozedEvents,
    valueEvents,
    bills,
  ] = await Promise.all([
    prisma.emailConnection.findUnique({
      where: { userId },
      // Credential ciphertext is intentionally excluded from a browser download.
      select: {
        id: true,
        provider: true,
        emailAddress: true,
        expiry: true,
        scope: true,
        lastScanAt: true,
        scanMode: true,
        imapUser: true,
        imapHost: true,
        imapPort: true,
        imapSecure: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.emailTransaction.findMany({ where: { userId }, include: { receiptDocuments: true }, orderBy: { purchasedAt: "desc" } }),
    prisma.receiptUpload.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.purchase.findMany({
      where: { userId },
      include: { items: true, attachments: true },
      orderBy: { purchasedAt: "desc" },
    }),
    prisma.returnItem.findMany({
      where: { userId },
      include: { shipmentEvents: true, refundCase: true },
      orderBy: { returnBy: "desc" },
    }),
    prisma.subscription.findMany({ where: { userId }, orderBy: { renewalDate: "desc" } }),
    prisma.subscriptionPayment.findMany({ where: { userId }, orderBy: { paidAt: "desc" } }),
    prisma.detectedItem.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.automationSuggestion.findMany({ where: { userId }, orderBy: { detectedDate: "desc" } }),
    prisma.notification.findMany({ where: { userId }, include: { jobs: true }, orderBy: { createdAt: "desc" } }),
    prisma.notificationPreference.findUnique({ where: { userId } }),
    prisma.snoozedEvent.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.valueEvent.findMany({ where: { userId }, orderBy: { occurredAt: "desc" } }),
    prisma.bill.findMany({ where: { userId }, orderBy: { name: "asc" } }),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    emailConnection,
    emailTransactions,
    receiptUploads,
    purchases,
    returns,
    subscriptions,
    subscriptionPayments,
    detectedItems,
    automationSuggestions,
    notifications,
    notificationPreference,
    snoozedEvents,
    valueEvents,
    bills,
  };

  const json = JSON.stringify(payload, null, 2);

  return new NextResponse(json, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": "attachment; filename=pickme-export.json",
    },
  });
}
