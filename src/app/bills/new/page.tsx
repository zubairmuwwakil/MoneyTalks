import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import type { Catalogue, OwnerState } from "@/engine/cards-twin";
import { billSpendCategoryOptions } from "@/lib/domain/bills/cardForBill";
import { buildBillRouteWallet } from "@/lib/domain/bills/billRouteWallet";
import { ensureOwnerStateRecord } from "@/lib/domain/ownerState";
import { cardCatalogue } from "@/lib/contracts/cardCatalogue";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { BillFormFields } from "./form-fields";

// Same module-level-singleton + cast precedent as src/app/bills/page.tsx —
// the catalogue JSON never changes at runtime, so the option list is
// derived once at module load, not per request.
const catalogue = cardCatalogue as unknown as Catalogue;
const spendCategoryOptions = billSpendCategoryOptions(catalogue);

export default async function NewBillPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const userId = await requireUserId();
  const { error } = await searchParams;
  const [ownerStateRecord, storedCards, bankAccounts] = await Promise.all([
    ensureOwnerStateRecord(prisma, userId),
    prisma.creditCard.findMany({
      where: { userId },
      select: { id: true, nickname: true, contractCardId: true, lastFour: true },
      orderBy: { nickname: "asc" },
    }),
    prisma.financialAccount.findMany({
      where: { userId, type: { in: ["CHEQUING", "CASH"] } },
      select: { id: true, name: true, institution: true, type: true },
      orderBy: [{ institution: "asc" }, { name: "asc" }],
    }),
  ]);
  const ownerState = ownerStateRecord
    ? (ownerStateRecord.stateData as unknown as OwnerState)
    : null;
  const routeWalletCards = buildBillRouteWallet(
    catalogue,
    ownerState,
    storedCards,
    new Date().toISOString().slice(0, 10),
  );

  return (
    <main className="max-w-2xl mx-auto space-y-6 py-6 sm:py-10 px-4 sm:px-0">
      {/* Header Navigation */}
      <div>
        <Link
          href="/bills"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground mb-3 transition-colors group"
        >
          <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
          <span>Back to Bills</span>
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Add Bill or Subscription
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Forecast cashflow, eliminate late fees, and unlock maximum card multiplier rewards.
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles className="size-3.5" />
            <span>Card Copilot Optimized</span>
          </div>
        </div>
      </div>

      {/* Bill Form Fields Component */}
      <BillFormFields
        spendCategoryOptions={spendCategoryOptions}
        routeWalletCards={routeWalletCards}
        savedCards={storedCards.map(({ id, nickname, lastFour }) => ({ id, nickname, lastFour }))}
        bankAccounts={bankAccounts}
        initialError={error}
      />
    </main>
  );
}

