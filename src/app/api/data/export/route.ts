import { NextResponse } from "next/server";
import { recordSubscriptionDataOperation } from "@/lib/observability";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  try {
    const [
      emailConnections,
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
      emailObligationFacts,
      recurringObligations,
      recurringObligationOwnerFacts,
      legacySubscriptionMappings,
    ] = await Promise.all([
      prisma.emailConnection.findMany({
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
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "asc" },
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
      prisma.bill.findMany({
        where: { userId },
        // A browser export must never contain decryptable secret envelopes or
        // legacy plaintext. The safe suffix still lets the user identify the
        // account represented by each bill.
        omit: { accountNumber: true, accountNumberEncrypted: true },
        orderBy: { name: "asc" },
      }),
      // The facts derived from the owner's mail, snippets included: the quoted
      // text is their own message, and an export that withheld the reasoning
      // would hand back conclusions with no way to check them.
      prisma.emailObligationFact.findMany({ where: { userId }, orderBy: { occurredAt: "desc" } }),
      prisma.recurringObligation.findMany({ where: { userId }, include: { evidence: true }, orderBy: { updatedAt: "desc" } }),
      prisma.recurringObligationOwnerFact.findMany({ where: { userId }, orderBy: { occurredAt: "desc" } }),
      prisma.legacySubscriptionMapping.findMany({ where: { userId }, orderBy: { migratedAt: "desc" } }),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      emailConnections,
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
      emailObligationFacts,
      recurringObligations,
      recurringObligationOwnerFacts,
      legacySubscriptionMappings,
    };

    const json = JSON.stringify(payload, null, 2);

    recordSubscriptionDataOperation({ operation: "export", outcome: "success" });
    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": "attachment; filename=pickme-export.json",
      },
    });
  } catch (error) {
    recordSubscriptionDataOperation({ operation: "export", outcome: "failure" });
    throw error;
  }
}
