import { prisma } from "@/lib/prisma";

export interface TransactionRecord {
  id: string;
  date: Date;
  title: string;
  amount: number;
  currency: string;
  type: "payment" | "refund" | "pending";
  notes?: string | null;
  status: string;
  estimated?: boolean;
}


export async function getReturnTransactionHistory(userId: string, returnId: string) {
  if (!returnId) return [];

  const ret = await prisma.returnItem.findUnique({
    where: { id: returnId },
  });

  if (!ret || ret.userId !== userId) return [];

  const transactions: TransactionRecord[] = [];

  const shipmentEvents = await prisma.shipmentEvent.findMany({
    where: { userId, returnId },
    orderBy: { occurredAt: "asc" },
  });

  // Purchase transaction
  transactions.push({
    id: `${ret.id}-purchase`,
    date: ret.purchaseDate,
    title: "Purchase",
    amount: ret.amountCents ?? 0,
    currency: ret.currency,
    type: "payment" as const,
    status: "COMPLETED",
  });

  // Return deadline
  transactions.push({
    id: `${ret.id}-deadline`,
    date: ret.returnBy,
    title: "Return Deadline",
    amount: 0,
    currency: ret.currency,
    type: ret.status === "REFUNDED" ? ("payment" as const) : ("pending" as const),
    status: ret.status,
  });

  // Drop-off date if exists
  if (ret.dropoffDate) {
    transactions.push({
      id: `${ret.id}-dropoff`,
      date: ret.dropoffDate,
      title: "Dropped Off",
      amount: 0,
      currency: ret.currency,
      type: "payment" as const,
      status: "COMPLETED",
    });
  }

  // Shipment events timeline
  for (const se of shipmentEvents) {
    transactions.push({
      id: se.id,
      date: se.occurredAt,
      title: se.statusText,
      amount: 0,
      currency: ret.currency,
      type: "pending" as const,
      notes: se.location,
      status: se.statusCode,
      estimated: true,
    });
  }

  // Expected refund date
  if (ret.refundExpectedAt) {
    transactions.push({
      id: `${ret.id}-expected`,
      date: ret.refundExpectedAt,
      title: "Refund Expected By",
      amount: ret.refundAmountCents ?? ret.amountCents ?? 0,
      currency: ret.currency,
      type: ret.refundedDate ? ("payment" as const) : ("pending" as const),
      status: "PENDING",
      estimated: true,
    });
  }

  // Actual refund date
  if (ret.refundedDate) {
    transactions.push({
      id: `${ret.id}-refund`,
      date: ret.refundedDate,
      title: "Refunded",
      amount: ret.refundAmountCents ?? ret.amountCents ?? 0,
      currency: ret.currency,
      type: "refund" as const,
      notes: ret.refundAmountCents ? `${ret.refundAmountCents} cents refunded` : undefined,
      status: "COMPLETED",
    });
  }

  return transactions.sort((a, b) => a.date.getTime() - b.date.getTime());
}

export async function getSubscriptionTransactionHistory(
  userId: string,
  subscriptionId: string
) {
  const payments = await prisma.subscriptionPayment.findMany({
    where: { userId, subscriptionId },
    orderBy: { paidAt: "desc" },
  });

  return payments.map((p: any) => ({
    id: p.id,
    date: p.paidAt,
    title: "Payment",
    amount: p.amountCents,
    currency: p.currency,
    type: "payment" as const,
    notes: p.notes,
    status: "PAID",
  }));
}
