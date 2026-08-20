"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { dedupeHash, mapRows, parseCsv, type ColumnMapping, type MappedRow } from "@/engine/csv";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { csvImportInput, type CsvImportInput } from "@/lib/validation/csv-import";
import { IMPORT_LIMITS } from "@/lib/validation/investments";
import { recomputeSnapshotFlows } from "@/lib/domain/investments/captureInvestmentSnapshots";

export interface CsvImportResult {
  ok: boolean;
  error?: string;
  imported?: number;
  skippedDuplicates?: number;
  errors?: number;
}

export interface CsvPreviewResult {
  ok: boolean;
  error?: string;
  rows?: { date: string; description: string; amountMinor: number; type: CsvImportInput["positiveType"] }[];
  errorRows?: { rowIndex: number; error: string }[];
  totalMapped?: number;
  totalErrors?: number;
}

interface LoadedCsv {
  ok: true;
  accountId: string;
  currency: string;
  positiveType: CsvImportInput["positiveType"];
  negativeType: CsvImportInput["negativeType"];
  rows: MappedRow[];
}
interface LoadFailure {
  ok: false;
  error: string;
}

/**
 * Shared by importCsv and previewCsv so both run the exact same
 * auth/ownership check, form validation, and parse+mapping call path
 * (parseCsv -> mapRows) — the preview must show precisely what an import
 * would do, not a reimplementation of it.
 */
async function loadMappedRows(formData: FormData): Promise<LoadedCsv | LoadFailure> {
  const userId = await requireUserId();
  const accountId = String(formData.get("accountId") ?? "");
  const account = await prisma.financialAccount.findFirst({ where: { id: accountId, userId } });
  if (!account) return { ok: false, error: "Account not found" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file uploaded" };
  if (file.size > IMPORT_LIMITS.fileBytes) {
    return {
      ok: false,
      error: `CSV file is too large; maximum is ${Math.floor(IMPORT_LIMITS.fileBytes / (1024 * 1024))} MB`,
    };
  }

  const parsedMapping = csvImportInput.safeParse({
    dateCol: formData.get("dateCol"),
    amountCol: formData.get("amountCol"),
    descriptionCol: formData.get("descriptionCol"),
    dateFormat: formData.get("dateFormat"),
    negate: formData.get("negate") ?? "false",
    hasHeader: formData.get("hasHeader") ?? "false",
    positiveType: formData.get("positiveType"),
    negativeType: formData.get("negativeType"),
  });
  if (!parsedMapping.success) {
    const issue = parsedMapping.error.issues[0];
    return { ok: false, error: `${issue.path.join(".")}: ${issue.message}` };
  }
  const { dateCol, amountCol, descriptionCol, dateFormat, negate, hasHeader, positiveType, negativeType } =
    parsedMapping.data;
  const mapping: ColumnMapping = { dateCol, amountCol, descriptionCol, dateFormat, negate, hasHeader };

  let rows: MappedRow[];
  try {
    rows = mapRows(parseCsv(await file.text()), mapping);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Parse failed" };
  }

  return { ok: true, accountId, currency: account.currency, positiveType, negativeType, rows };
}

/**
 * Resolves a mapped row to exactly what importCsv will store: an unsigned
 * amountMinor plus the TxType that carries the direction. Shared by
 * previewCsv and importCsv's insert loop so the two cannot drift — the
 * preview must show what actually lands in the database, not the raw
 * signed amount mapRows produces.
 */
function resolveStoredRow(
  row: Extract<MappedRow, { date: string }>,
  positiveType: CsvImportInput["positiveType"],
  negativeType: CsvImportInput["negativeType"],
): { amountMinor: number; type: CsvImportInput["positiveType"] } {
  return {
    amountMinor: Math.abs(row.amountMinor),
    type: row.amountMinor >= 0 ? positiveType : negativeType,
  };
}

/** Parses and maps the upload but writes nothing — lets the user check column/sign mapping before committing. */
export async function previewCsv(formData: FormData): Promise<CsvPreviewResult> {
  const loaded = await loadMappedRows(formData);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const { positiveType, negativeType } = loaded;

  const mapped = loaded.rows.filter((r): r is Extract<MappedRow, { date: string }> => !("error" in r));
  const errorRows = loaded.rows
    .filter((r): r is Extract<MappedRow, { error: string }> => "error" in r)
    .map((r) => ({ rowIndex: r.rowIndex, error: r.error }));

  return {
    ok: true,
    rows: mapped.slice(0, 10).map((r) => ({
      date: r.date,
      description: r.description,
      ...resolveStoredRow(r, positiveType, negativeType),
    })),
    errorRows,
    totalMapped: mapped.length,
    totalErrors: errorRows.length,
  };
}

export async function importCsv(formData: FormData): Promise<CsvImportResult> {
  const loaded = await loadMappedRows(formData);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const { accountId, currency, positiveType, negativeType, rows } = loaded;

  const existing = new Set(
    (
      await prisma.transaction.findMany({
        where: { accountId, dedupeHash: { not: null } },
        select: { dedupeHash: true },
      })
    ).map((t) => t.dedupeHash),
  );

  const toInsert: Prisma.TransactionCreateManyInput[] = [];
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
    const { amountMinor, type } = resolveStoredRow(row, positiveType, negativeType);
    toInsert.push({
      accountId,
      type,
      amountMinor,
      currency,
      date: new Date(row.date),
      description: row.description || undefined,
      dedupeHash: hash,
    });
  }

  // A single createMany is atomic by definition (one statement, one round
  // trip) and avoids both an N-row interactive-transaction timeout and a
  // partial import if something fails mid-loop.
  let imported = 0;
  if (toInsert.length > 0) {
    try {
      const created = await prisma.transaction.createMany({ data: toInsert });
      imported = created.count;
      const insertedDates = toInsert.map((transaction) => new Date(transaction.date));
      const earliestAffected = new Date(Math.min(...insertedDates.map((date) => date.getTime())));
      await recomputeSnapshotFlows(prisma, accountId, earliestAffected);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Insert failed" };
    }
  }

  revalidatePath(`/investments/${accountId}`);
  revalidatePath("/investments");
  revalidatePath("/");
  return { ok: true, imported, skippedDuplicates, errors };
}
