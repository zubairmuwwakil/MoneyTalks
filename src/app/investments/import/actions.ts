"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { IMPORT_LIMITS, importFile } from "@/lib/validation/investments";

export interface ImportResult {
  ok: boolean;
  error?: string;
  accounts?: number;
  holdings?: number;
  snapshots?: number;
  fxRates?: number;
  bills?: number;
}

/** Json columns are validated by zod on the way in, not by the type system. */
function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function importJson(formData: FormData): Promise<ImportResult> {
  const userId = await requireUserId();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file uploaded" };
  if (file.size > IMPORT_LIMITS.fileBytes) {
    return {
      ok: false,
      error: `Import file is too large; maximum is ${Math.floor(IMPORT_LIMITS.fileBytes / (1024 * 1024))} MB`,
    };
  }

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

  let counts: Required<Pick<ImportResult, "accounts" | "holdings" | "snapshots" | "fxRates" | "bills">>;
  try {
    counts = await prisma.$transaction(
      async (tx) => {
        let accounts = 0;
        let holdings = 0;
        let snapshots = 0;
        let fxRates = 0;
        let bills = 0;

        for (const entry of parsed.data.accounts) {
          const { holdings: hs, snapshots: ss, ...accountData } = entry;
          const { currency, ...editableAccountData } = accountData;
          const key = {
            userId,
            name: accountData.name,
            institution: accountData.institution,
          };
          const existing = await tx.financialAccount.findUnique({
            where: { userId_name_institution: key },
            select: { currency: true },
          });
          if (existing && existing.currency !== currency) {
            throw new Error(
              `Currency for ${accountData.name} cannot change from ${existing.currency} to ${currency} after account creation`,
            );
          }

          const account = await tx.financialAccount.upsert({
            where: { userId_name_institution: key },
            update: editableAccountData,
            create: { ...accountData, userId },
          });
          accounts += 1;

          for (const h of hs ?? []) {
            await tx.holding.upsert({
              where: { accountId_symbol: { accountId: account.id, symbol: h.symbol } },
              update: { ...h, priceAsOf: new Date(h.priceAsOf) },
              create: { ...h, accountId: account.id, priceAsOf: new Date(h.priceAsOf) },
            });
            holdings += 1;
          }

          for (const s of ss ?? []) {
            await tx.balanceSnapshot.upsert({
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
          await tx.fxRate.upsert({
            where: { userId_base_quote_asOf: { userId, base: r.base, quote: r.quote, asOf: new Date(r.asOf) } },
            update: { rate: r.rate },
            create: { userId, base: r.base, quote: r.quote, rate: r.rate, asOf: new Date(r.asOf) },
          });
          fxRates += 1;
        }

        for (const b of parsed.data.bills ?? []) {
          const { cadence, schedule, ...core } = b;
          await tx.bill.upsert({
            where: { userId_name: { userId, name: core.name } },
            update: { ...core, cadence: asJson(cadence), schedule: asJson(schedule) },
            create: { ...core, userId, cadence: asJson(cadence), schedule: asJson(schedule) },
          });
          bills += 1;
        }

        return { accounts, holdings, snapshots, fxRates, bills };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Import failed" };
  }

  revalidatePath("/investments");
  revalidatePath("/bills");
  revalidatePath("/");
  return { ok: true, ...counts };
}
