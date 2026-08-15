"use server";

import { revalidatePath } from "next/cache";
import { dedupeHash, mapRows, parseCsv, type ColumnMapping } from "@/engine/csv";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export interface CsvImportResult {
  ok: boolean;
  error?: string;
  imported?: number;
  skippedDuplicates?: number;
  errors?: number;
}

export async function importCsv(formData: FormData): Promise<CsvImportResult> {
  const userId = await requireUserId();
  const accountId = String(formData.get("accountId") ?? "");
  const account = await prisma.financialAccount.findFirst({ where: { id: accountId, userId } });
  if (!account) return { ok: false, error: "Account not found" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file uploaded" };

  const mapping: ColumnMapping = {
    dateCol: Number(formData.get("dateCol")),
    amountCol: Number(formData.get("amountCol")),
    descriptionCol: Number(formData.get("descriptionCol")),
    dateFormat: String(formData.get("dateFormat")) as ColumnMapping["dateFormat"],
    negate: formData.get("negate") === "true",
    hasHeader: formData.get("hasHeader") === "true",
  };
  const positiveType = String(formData.get("positiveType") ?? "CONTRIBUTION");
  const negativeType = String(formData.get("negativeType") ?? "WITHDRAWAL");
  const VALID = ["CONTRIBUTION", "WITHDRAWAL", "BUY", "SELL", "DIVIDEND", "INTEREST", "FEE"];
  if (!VALID.includes(positiveType) || !VALID.includes(negativeType)) {
    return { ok: false, error: "Bad type mapping" };
  }

  let rows;
  try {
    rows = mapRows(parseCsv(await file.text()), mapping);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Parse failed" };
  }

  const existing = new Set(
    (
      await prisma.transaction.findMany({
        where: { accountId, dedupeHash: { not: null } },
        select: { dedupeHash: true },
      })
    ).map((t) => t.dedupeHash),
  );

  let imported = 0;
  let skippedDuplicates = 0;
  let errors = 0;

  for (const row of rows) {
    if ("error" in row) {
      errors += 1;
      continue;
    }
    const hash = dedupeHash(accountId, row.date, row.amountMinor, row.description);
    if (existing.has(hash)) {
      skippedDuplicates += 1;
      continue;
    }
    existing.add(hash);
    await prisma.transaction.create({
      data: {
        accountId,
        type: (row.amountMinor >= 0 ? positiveType : negativeType) as never,
        amountMinor: Math.abs(row.amountMinor),
        currency: account.currency,
        date: new Date(row.date),
        description: row.description || undefined,
        dedupeHash: hash,
      },
    });
    imported += 1;
  }

  revalidatePath(`/investments/${accountId}`);
  revalidatePath("/");
  return { ok: true, imported, skippedDuplicates, errors };
}
