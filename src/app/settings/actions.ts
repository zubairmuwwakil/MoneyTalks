"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { IncomeSource } from "@/engine/rules/types";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { incomeSourceInput, profileInput } from "@/lib/validation/profile";

type ActionResult = { ok: true } | { ok: false; error: string };
const cardShoppingMarketInput = z.enum(["CA", "US"]);

// Prisma's Json column input requires a structurally-open type; an `interface` has no
// implicit index signature, so the array needs an explicit widening at this boundary.
function toJson(sources: IncomeSource[]): Prisma.InputJsonValue {
  return sources as unknown as Prisma.InputJsonValue;
}

export async function updateProfile(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = profileInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue.path.join(".")}: ${issue.message}` };
  }
  await prisma.profile.upsert({
    where: { userId },
    update: parsed.data,
    create: { userId, ...parsed.data },
  });
  revalidatePath("/settings");
  revalidatePath("/money-finder");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Updates only the catalogue browsing preference. This is intentionally not
 * derived from residency: a person can shop another market without changing
 * their tax profile.
 */
export async function setCardShoppingMarket(market: unknown): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = cardShoppingMarketInput.safeParse(market);
  if (!parsed.success) return { ok: false, error: "Choose Canada or the United States." };

  await prisma.profile.upsert({
    where: { userId },
    update: { cardShoppingMarket: parsed.data },
    create: { userId, cardShoppingMarket: parsed.data },
  });
  revalidatePath("/cards/new");
  revalidatePath("/settings");
  return { ok: true };
}

export async function addIncomeSource(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = incomeSourceInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue.path.join(".")}: ${issue.message}` };
  }
  const row = await prisma.profile.upsert({ where: { userId }, update: {}, create: { userId } });
  const sources = ((row.incomeSources as IncomeSource[] | null) ?? []).concat(parsed.data);
  await prisma.profile.update({ where: { userId }, data: { incomeSources: toJson(sources) } });
  revalidatePath("/settings");
  revalidatePath("/money-finder");
  return { ok: true };
}

export async function removeIncomeSource(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const index = Number(formData.get("index"));
  const row = await prisma.profile.findUnique({ where: { userId } });
  if (!row || !Number.isInteger(index)) return { ok: false, error: "Not found" };
  const sources = ((row.incomeSources as IncomeSource[] | null) ?? []).filter((_, i) => i !== index);
  await prisma.profile.update({ where: { userId }, data: { incomeSources: toJson(sources) } });
  revalidatePath("/settings");
  revalidatePath("/money-finder");
  return { ok: true };
}
