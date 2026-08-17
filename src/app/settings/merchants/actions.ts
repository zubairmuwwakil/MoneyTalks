"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

const updateMerchantAliasInput = z.object({
  id: z.string().min(1),
  normalizedName: z.string().trim().min(1, "Merchant name cannot be empty"),
  category: z
    .string()
    .trim()
    .nullish()
    .transform((val) => (val && val.length > 0 ? val : null)),
});

export type UpdateMerchantAliasResult =
  | { ok: true; alias: { id: string; rawString: string; normalizedName: string; category: string | null } }
  | { ok: false; error: string };

// Note on global MerchantAlias table:
// MerchantAlias is global across all users (merchant identity is universal).
// A rename affects all users sharing the alias; that is accepted for the beta
// (see docs/decisions/LOG.md). The backfill is scoped to rows whose merchantRaw
// matches the alias rawString and whose current value matches the old normalizedName.
export async function updateMerchantAlias(input: {
  id: string;
  normalizedName: string;
  category?: string | null;
}): Promise<UpdateMerchantAliasResult> {
  await requireUserId();

  const parsed = updateMerchantAliasInput.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return { ok: false, error: firstIssue?.message ?? "Invalid input" };
  }

  const { id, normalizedName, category } = parsed.data;

  return await prisma.$transaction(async (tx) => {
    const existing = await tx.merchantAlias.findUnique({
      where: { id },
    });

    if (!existing) {
      return { ok: false, error: "Merchant alias not found" };
    }

    const isRename = existing.normalizedName !== normalizedName;

    const updated = await tx.merchantAlias.update({
      where: { id },
      data: {
        normalizedName,
        category,
      },
    });

    if (isRename) {
      // 1. Backfill WalletEvent.merchantNormalized for rows whose current value
      // equals the old normalizedName and whose merchantRaw matches the alias rawString.
      await tx.walletEvent.updateMany({
        where: {
          merchantRaw: existing.rawString,
          merchantNormalized: existing.normalizedName,
        },
        data: {
          merchantNormalized: normalizedName,
        },
      });

      // 2. Backfill Purchase.merchant for rows whose current value equals
      // the old normalizedName and whose linked wallet event merchantRaw matches the alias rawString.
      await tx.purchase.updateMany({
        where: {
          merchant: existing.normalizedName,
          walletEvents: {
            some: {
              merchantRaw: existing.rawString,
            },
          },
        },
        data: {
          merchant: normalizedName,
        },
      });
    }

    revalidatePath("/settings/merchants");
    revalidatePath("/purchases");
    revalidatePath("/cards/reconcile");

    return {
      ok: true,
      alias: {
        id: updated.id,
        rawString: updated.rawString,
        normalizedName: updated.normalizedName,
        category: updated.category,
      },
    };
  });
}
