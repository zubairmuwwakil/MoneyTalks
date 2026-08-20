"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { catalogueCredits, type RedeemedCredit } from "@/lib/cards/catalogueCard";
import { parseDollarsToMinor } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { cardImportEntry } from "@/lib/validation/cards";

type ActionResult = { ok: true } | { ok: false; error: string };

export type CardFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

async function ownedCard(userId: string, cardId: string) {
  const card = await prisma.creditCard.findFirst({ where: { id: cardId, userId }, include: { state: true } });
  if (!card) throw new Error("Card not found");
  return card;
}

export async function createCard(_previousState: CardFormState, formData: FormData): Promise<CardFormState> {
  const userId = await requireUserId();
  const parsed = parsedCardFromForm(formData);
  if (!parsed.success) return parsed.state;

  const core = parsed.data;
  const existing = await prisma.creditCard.findUnique({
    where: { userId_nickname: { userId, nickname: core.nickname } },
    select: { id: true },
  });
  if (existing) return nicknameTakenState();

  let cardId: string;
  try {
    const card = await prisma.creditCard.create({ data: { ...core, userId }, select: { id: true } });
    cardId = card.id;
  } catch (error) {
    if (isUniqueConstraintError(error)) return nicknameTakenState();
    return { error: "Could not save this card. Please try again." };
  }

  revalidateCardRoutes(cardId);
  redirect(`/cards/${cardId}`);
}

export async function updateCard(_previousState: CardFormState, formData: FormData): Promise<CardFormState> {
  const userId = await requireUserId();
  const parsed = parsedCardFromForm(formData);
  if (!parsed.success) return parsed.state;

  const cardId = String(formData.get("cardId") ?? "").trim();
  if (!cardId) return { error: "The card to update is missing. Please return to Manage cards and try again." };

  const core = parsed.data;
  try {
    const card = await ownedCard(userId, cardId);
    const existing = await prisma.creditCard.findUnique({
      where: { userId_nickname: { userId, nickname: core.nickname } },
      select: { id: true },
    });
    if (existing && existing.id !== card.id) return nicknameTakenState();

    await prisma.creditCard.update({ where: { id: card.id }, data: core });
  } catch (error) {
    if (isUniqueConstraintError(error)) return nicknameTakenState();
    return {
      error:
        error instanceof Error && error.message === "Card not found"
          ? error.message
          : "Could not save this card. Please try again.",
    };
  }

  revalidateCardRoutes(cardId);
  redirect(`/cards/${cardId}`);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function formStateFromIssues(issues: { path: PropertyKey[]; message: string }[]): CardFormState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.join(".") || "form";
    fieldErrors[path] ??= issue.message;
  }
  return { error: "Check the highlighted fields and try again.", fieldErrors };
}

function parsedCardFromForm(formData: FormData):
  | { success: true; data: ReturnType<typeof cardImportEntry.parse> }
  | { success: false; state: CardFormState } {
  const raw = formData.get("cardJson");
  if (typeof raw !== "string") {
    return { success: false, state: { error: "The card form could not be read. Please try again." } };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { success: false, state: { error: "The card form could not be read. Please try again." } };
  }

  const parsed = cardImportEntry.safeParse(value);
  if (!parsed.success) return { success: false, state: formStateFromIssues(parsed.error.issues) };
  return { success: true, data: parsed.data };
}

function nicknameTakenState(): CardFormState {
  return { fieldErrors: { nickname: "You already have a card with this nickname." } };
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function revalidateCardRoutes(cardId?: string) {
  revalidatePath("/");
  revalidatePath("/cards");
  revalidatePath("/cards/manage");
  if (cardId) revalidatePath(`/cards/${cardId}`);
}

/**
 * Marks a catalogue credit used (or un-used) for the current period.
 *
 * The credit DEFINITIONS come from the catalogue via `contractCardId`; only the
 * redemption — owner activity — is stored here. An unlinked card has no credits
 * to redeem, which is stated rather than silently succeeding.
 */
export async function toggleCredit(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const cardId = String(formData.get("cardId") ?? "");
  const creditId = String(formData.get("creditId") ?? "");
  try {
    const card = await ownedCard(userId, cardId);
    const credit = catalogueCredits(card.contractCardId).find((c) => c.creditId === creditId);
    if (!credit) return { ok: false, error: "Unknown credit for this card" };
    const periodKey = credit.period === "calendarMonth" ? today().slice(0, 7) : today().slice(0, 4);
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
  let cardId: string;
  try {
    const card = await ownedCard(userId, String(formData.get("cardId") ?? ""));
    cardId = card.id;
    await prisma.creditCard.delete({ where: { id: card.id } });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
  revalidateCardRoutes(cardId);
  redirect("/cards/manage");
}
