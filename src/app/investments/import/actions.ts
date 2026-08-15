"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { importFile } from "@/lib/validation/investments";

export interface ImportResult {
  ok: boolean;
  error?: string;
  accounts?: number;
  holdings?: number;
  snapshots?: number;
  fxRates?: number;
}

export async function importJson(formData: FormData): Promise<ImportResult> {
  const userId = await requireUserId();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file uploaded" };

  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    return { ok: false, error: "File is not valid JSON" };
  }

  const parsed = importFile.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue.path.join(".")}: ${issue.message}` };
  }

  let accounts = 0;
  let holdings = 0;
  let snapshots = 0;
  let fxRates = 0;

  for (const entry of parsed.data.accounts) {
    const { holdings: hs, snapshots: ss, ...accountData } = entry;
    const account = await prisma.financialAccount.upsert({
      where: {
        userId_name_institution: {
          userId,
          name: accountData.name,
          institution: accountData.institution,
        },
      },
      update: accountData,
      create: { ...accountData, userId },
    });
    accounts += 1;

    for (const h of hs ?? []) {
      await prisma.holding.upsert({
        where: { accountId_symbol: { accountId: account.id, symbol: h.symbol } },
        update: { ...h, priceAsOf: new Date(h.priceAsOf) },
        create: { ...h, accountId: account.id, priceAsOf: new Date(h.priceAsOf) },
      });
      holdings += 1;
    }

    for (const s of ss ?? []) {
      await prisma.balanceSnapshot.upsert({
        where: { accountId_asOf: { accountId: account.id, asOf: new Date(s.asOf) } },
        update: { balanceMinor: s.balanceMinor },
        create: {
          accountId: account.id,
          balanceMinor: s.balanceMinor,
          currency: account.currency,
          asOf: new Date(s.asOf),
        },
      });
      snapshots += 1;
    }
  }

  for (const r of parsed.data.fxRates ?? []) {
    await prisma.fxRate.upsert({
      where: { userId_base_quote_asOf: { userId, base: r.base, quote: r.quote, asOf: new Date(r.asOf) } },
      update: { rate: r.rate },
      create: { userId, base: r.base, quote: r.quote, rate: r.rate, asOf: new Date(r.asOf) },
    });
    fxRates += 1;
  }

  revalidatePath("/investments");
  revalidatePath("/");
  return { ok: true, accounts, holdings, snapshots, fxRates };
}
