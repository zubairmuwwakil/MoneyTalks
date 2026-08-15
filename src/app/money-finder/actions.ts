"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export async function dismissAlert(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const ruleKey = String(formData.get("ruleKey") ?? "");
  const entityRef = String(formData.get("entityRef") ?? "");
  if (!ruleKey) return;
  await prisma.alert.upsert({
    where: { userId_ruleKey_entityRef: { userId, ruleKey, entityRef } },
    update: { dismissedAt: new Date() },
    create: { userId, ruleKey, entityRef },
  });
  revalidatePath("/money-finder");
  revalidatePath("/");
}

export async function restoreAlert(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const ruleKey = String(formData.get("ruleKey") ?? "");
  const entityRef = String(formData.get("entityRef") ?? "");
  await prisma.alert.deleteMany({ where: { userId, ruleKey, entityRef } });
  revalidatePath("/money-finder");
  revalidatePath("/");
}
