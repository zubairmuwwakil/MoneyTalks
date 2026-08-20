"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export type CardRequestState = { ok?: true; error?: string };

const requestInput = z.object({
  issuer: z.string().trim().min(1, "Who issues the card?").max(60),
  cardName: z.string().trim().min(1, "What is the card called?").max(100),
  note: z.string().trim().max(500).optional(),
});

/**
 * D3's demand-driven expansion path. With hand-authored rates removed, this is
 * the only way an uncatalogued card gets in — deliberately, because the moat is
 * that every rule in the catalogue is confirmed against the issuer. A user is
 * never left without a route, but they also can't type their own rates in.
 */
export async function requestCard(
  _previous: CardRequestState,
  formData: FormData,
): Promise<CardRequestState> {
  const userId = await requireUserId();
  const parsed = requestInput.safeParse({
    issuer: formData.get("issuer"),
    cardName: formData.get("cardName"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };

  const { issuer, cardName, note } = parsed.data;
  try {
    // Re-requesting the same card is not an error; it is the same signal twice.
    const existing = await prisma.cardRequest.findFirst({ where: { userId, issuer, cardName } });
    if (!existing) await prisma.cardRequest.create({ data: { userId, issuer, cardName, note } });
  } catch {
    return { error: "Could not send that request. Please try again." };
  }

  revalidatePath("/cards/request");
  return { ok: true };
}
