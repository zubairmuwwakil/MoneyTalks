import { classifyWriteOff } from "@/engine/tax-writeoffs/classifyWriteOff";
import type { WriteOffItem } from "@/engine/tax-writeoffs/writeOffSummary";
import type { Currency } from "@/engine/money";
import { getOrCreateProfile } from "@/lib/profile";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { WriteOffsClient } from "./ui/WriteOffsClient";

export default async function WriteOffsPage() {
  const userId = await requireUserId();
  const currentYear = new Date().getFullYear().toString();

  const [profile, purchases, bills] = await Promise.all([
    getOrCreateProfile(userId),
    prisma.purchase.findMany({
      where: { userId },
      include: {
        items: { select: { title: true } },
        attachments: { select: { id: true } },
      },
      orderBy: { purchasedAt: "desc" },
      take: 250,
    }),
    prisma.bill.findMany({
      where: { userId },
      include: { payments: true },
    }),
  ]);

  const writeOffItems: WriteOffItem[] = [];

  // 1. Evaluate Purchases
  for (const p of purchases) {
    const classification = classifyWriteOff({
      merchant: p.merchant,
      category: p.category,
      items: p.items,
    });

    if (classification.isCandidate && classification.taxLine) {
      const grossAmountMinor = p.totalCents ?? 0;
      const businessPct = classification.suggestedBusinessPct;
      const claimedAmountMinor = Math.round(grossAmountMinor * (businessPct / 100));
      const hasReceiptProof = p.attachments.length > 0;
      const date = p.purchasedAt.toISOString().slice(0, 10);

      writeOffItems.push({
        id: `purchase_${p.id}`,
        date,
        source: "PURCHASE",
        merchant: p.merchant,
        grossAmountMinor,
        currency: (p.currency ?? "CAD") as Currency,
        form: classification.taxLine.form,
        line: classification.taxLine.line,
        lineName: classification.taxLine.name,
        businessPct,
        claimedAmountMinor,
        hasReceiptProof,
        notes: classification.rationale,
      });
    }
  }

  // 2. Evaluate Recurring Bills
  for (const b of bills) {
    const classification = classifyWriteOff({
      merchant: b.payee || b.name,
      name: b.name,
      category: b.category,
      spendCategory: b.spendCategory,
      notes: b.notes,
    });

    if (classification.isCandidate && classification.taxLine) {
      // Include actual logged payments or generate annualized estimate
      if (b.payments.length > 0) {
        for (const payment of b.payments) {
          const grossAmountMinor = payment.actualAmountMinor ?? payment.expectedAmountMinor;
          const businessPct = classification.suggestedBusinessPct;
          const claimedAmountMinor = Math.round(grossAmountMinor * (businessPct / 100));
          const date = payment.dueDate.toISOString().slice(0, 10);

          writeOffItems.push({
            id: `bill_payment_${payment.id}`,
            date,
            source: "BILL",
            merchant: b.payee || b.name,
            grossAmountMinor,
            currency: (b.currency ?? "CAD") as Currency,
            form: classification.taxLine.form,
            line: classification.taxLine.line,
            lineName: classification.taxLine.name,
            businessPct,
            claimedAmountMinor,
            hasReceiptProof: false,
            notes: `${b.name} (${classification.taxLine.name})`,
          });
        }
      }
    }
  }

  // Deduplicate and sort
  const sortedItems = writeOffItems.sort((a, b) => (a.date < b.date ? 1 : -1));

  // Determine user marginal rate (from profile or standard Canadian 30% default)
  const marginalRate = profile.marginalUSRatePct || 30;

  return (
    <main className="max-w-4xl mx-auto space-y-6 py-6 sm:py-8 px-4 sm:px-0">
      <WriteOffsClient
        initialItems={sortedItems}
        initialTaxYear={currentYear}
        userMarginalRatePct={marginalRate}
      />
    </main>
  );
}
