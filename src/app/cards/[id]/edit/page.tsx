import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CardForm, type CardFormValues } from "@/components/card-form";
import { catalogueChoices } from "@/lib/cards/catalogueCard";
import { minorToDollarInput } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export default async function EditCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (/\.(png|webp|svg|jpg|jpeg|gif|ico|json)$/i.test(id)) {
    notFound();
  }
  const userId = await requireUserId();
  const card = await prisma.creditCard.findFirst({ where: { id, userId } });
  if (!card) notFound();

  const initialValues: CardFormValues = {
    contractCardId: card.contractCardId ?? "",
    nickname: card.nickname,
    issuer: card.issuer,
    network: card.network as CardFormValues["network"],
    lastFour: card.lastFour ?? "",
    country: card.country,
    currency: card.currency as CardFormValues["currency"],
    limit: card.limitMinor === null ? "" : minorToDollarInput(card.limitMinor),
    statementDay: card.statementDay?.toString() ?? "",
    dueDay: card.dueDay?.toString() ?? "",
    aprPct: card.aprPct?.toString() ?? "",
    annualFee: minorToDollarInput(card.annualFeeMinor),
    feeRebate: minorToDollarInput(card.feeRebateMinor),
    feeMonthDay: card.feeMonthDay ?? "",
    feeCancelGraceDays: card.feeCancelGraceDays.toString(),
  };

  return (
    <main className="max-w-6xl mx-auto space-y-6 py-6 sm:py-8">
      <div>
        <Link
          href={`/cards/${card.id}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to Card</span>
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Edit {card.nickname}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Update your nickname, fee rebates, renewal schedule, and account settings.
        </p>
      </div>

      <div className="mt-6">
        <CardForm
          mode="edit"
          cardId={card.id}
          choices={catalogueChoices()}
          initialValues={initialValues}
        />
      </div>
    </main>
  );
}
