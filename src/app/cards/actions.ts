"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { periodKeyFor, SPEND_CATEGORIES, type CapUsage, type CardRewards, type SpendCategory } from "@/engine/cards/types";
import type { RedeemedCredit } from "@/engine/cards/roi";
import { parseDollarsToMinor } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

type ActionResult = { ok: true } | { ok: false; error: string };

async function ownedCard(userId: string, cardId: string) {
  const card = await prisma.creditCard.findFirst({ where: { id: cardId, userId }, include: { state: true } });
  if (!card) throw new Error("Card not found");
  return card;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function addCapUsage(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const cardId = String(formData.get("cardId") ?? "");
  const category = String(formData.get("category") ?? "") as SpendCategory;
  const amountMinor = parseDollarsToMinor(String(formData.get("amount") ?? ""));
  if (!SPEND_CATEGORIES.includes(category)) return { ok: false, error: "Bad category" };
  if (amountMinor === null || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    return { ok: false, error: "Spend must be a dollar amount, e.g. 84.20" };
  }
  try {
    const card = await ownedCard(userId, cardId);
    const rewards = card.rewards as unknown as CardRewards;
    const rate = rewards.categoryRates.find((r) => r.category === category);
    const window = rate?.capWindow ?? "MONTH";
    const periodKey = periodKeyFor(window, today());
    const usage = ((card.state?.capsUsage as unknown as CapUsage[]) ?? []).slice();
    const existing = usage.find((u) => u.cardId === cardId && u.category === category && u.periodKey === periodKey);
    if (existing) existing.usedMinor += amountMinor;
    else usage.push({ cardId, category, periodKey, usedMinor: amountMinor });
    await prisma.cardState.upsert({
      where: { cardId },
      update: { capsUsage: asJson(usage) },
      create: { cardId, capsUsage: asJson(usage) },
    });
    revalidatePath("/cards");
    revalidatePath(`/cards/${cardId}`);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
  return { ok: true };
}

export async function toggleCredit(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const cardId = String(formData.get("cardId") ?? "");
  const creditId = String(formData.get("creditId") ?? "");
  try {
    const card = await ownedCard(userId, cardId);
    const rewards = card.rewards as unknown as CardRewards;
    const credit = rewards.credits.find((c) => c.id === creditId);
    if (!credit) return { ok: false, error: "Unknown credit" };
    const periodKey = periodKeyFor(credit.period, today());
    let redeemed = ((card.state?.creditsRedeemed as unknown as RedeemedCredit[]) ?? []).slice();
    const already = redeemed.some((r) => r.creditId === creditId && r.periodKey === periodKey);
    redeemed = already
      ? redeemed.filter((r) => !(r.creditId === creditId && r.periodKey === periodKey))
      : [...redeemed, { creditId, periodKey }];
    await prisma.cardState.upsert({
      where: { cardId },
      update: { creditsRedeemed: asJson(redeemed) },
      create: { cardId, creditsRedeemed: asJson(redeemed) },
    });
    revalidatePath(`/cards/${cardId}`);
    revalidatePath("/cards/manage");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
  return { ok: true };
}

export async function setRewardsEstimate(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const cardId = String(formData.get("cardId") ?? "");
  const estimate = parseDollarsToMinor(String(formData.get("rewardsEstimate") ?? ""));
  if (estimate === null || !Number.isSafeInteger(estimate) || estimate < 0) {
    return { ok: false, error: "Estimate must be a dollar amount, e.g. 240.00" };
  }
  try {
    await ownedCard(userId, cardId);
    await prisma.cardState.upsert({
      where: { cardId },
      update: { rewardsEstimateMinor: estimate },
      create: { cardId, rewardsEstimateMinor: estimate },
    });
    revalidatePath(`/cards/${cardId}`);
    revalidatePath("/cards/manage");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
  return { ok: true };
}

export async function deleteCard(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    const card = await ownedCard(userId, String(formData.get("cardId") ?? ""));
    await prisma.creditCard.delete({ where: { id: card.id } });
    revalidatePath("/cards");
    revalidatePath("/cards/manage");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
  return { ok: true };
}
