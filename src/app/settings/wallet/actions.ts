"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

const mapInput = z.object({
  rawString: z.string().min(1),
  contractCardId: z.string().min(1),
});

// Maps a raw Apple Pay card string ("American Express Cobalt") to one of the
// user's cards, then backfills every captured event that carried that string.
// Un-promoted events get picked up by the next normalization run.
export async function mapWalletCard(input: { rawString: string; contractCardId: string }) {
  const userId = await requireUserId();
  const parsed = mapInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "invalid input" };
  const { rawString, contractCardId } = parsed.data;

  const ownsCard = await prisma.creditCard.findFirst({
    where: { userId, contractCardId },
    select: { id: true },
  });
  if (!ownsCard) return { ok: false as const, error: "unknown card" };

  await prisma.cardAlias.upsert({
    where: { userId_rawString: { userId, rawString } },
    create: { userId, rawString, cardId: contractCardId },
    update: { cardId: contractCardId },
  });

  await prisma.walletEvent.updateMany({
    where: { userId, cardRaw: rawString },
    data: { resolvedCardId: contractCardId },
  });

  revalidatePath("/settings/wallet");
  return { ok: true as const };
}
