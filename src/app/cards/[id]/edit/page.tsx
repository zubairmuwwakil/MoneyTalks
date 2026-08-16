import { notFound } from "next/navigation";
import { CardForm, type CardFormValues } from "@/components/card-form";
import { minorToDollarInput } from "@/engine/money";
import type { CardRewards } from "@/engine/cards/types";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export default async function EditCardPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  const card = await prisma.creditCard.findFirst({ where: { id, userId } });
  if (!card) notFound();

  const rewards = card.rewards as unknown as CardRewards;
  const initialValues: CardFormValues = {
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
    rewards: {
      pointValueCents: rewards.pointValueCents.toString(),
      fxFeePct: rewards.fxFeePct.toString(),
      baseMultiplier: rewards.baseMultiplier.toString(),
      categoryRates: rewards.categoryRates.map((rate) => ({
        category: rate.category,
        multiplier: rate.multiplier.toString(),
        cap: rate.capMinor === undefined ? "" : minorToDollarInput(rate.capMinor),
        capWindow: rate.capWindow ?? "MONTH",
        capGroupId: rate.capGroupId ?? "",
        requiresConditionId: rate.requiresConditionId ?? "",
      })),
      credits: rewards.credits.map((credit) => ({
        id: credit.id,
        label: credit.label,
        value: minorToDollarInput(credit.valueMinor),
        period: credit.period,
      })),
      capGroups: (rewards.capGroups ?? []).map((group) => ({
        id: group.id,
        label: group.label,
        cap: minorToDollarInput(group.capMinor),
        capWindow: group.capWindow,
      })),
      conditions: (rewards.conditions ?? []).map((condition) => ({
        id: condition.id,
        label: condition.label,
        enabled: condition.enabled,
        annualFeeReduction:
          condition.annualFeeReductionMinor === undefined ? "" : minorToDollarInput(condition.annualFeeReductionMinor),
      })),
      merchantRates: (rewards.merchantRates ?? []).map((rate) => ({
        id: rate.id,
        merchant: rate.merchant,
        multiplier: rate.multiplier.toString(),
        requiresConditionId: rate.requiresConditionId ?? "",
      })),
    },
  };

  return (
    <main className="max-w-3xl py-8">
      <h1 className="text-xl font-semibold">Edit {card.nickname}</h1>
      <div className="mt-6">
        <CardForm mode="edit" cardId={card.id} initialValues={initialValues} />
      </div>
    </main>
  );
}
