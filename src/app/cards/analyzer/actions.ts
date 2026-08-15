"use server";

import { analyzeStatement } from "@/engine/cards/analyzer";
import type { CardDef, CardRewards } from "@/engine/cards/types";
import { mapRows, parseCsv, type ColumnMapping, type MappedRow } from "@/engine/csv";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { csvMappingInput } from "@/lib/validation/csv-import";
import { IMPORT_LIMITS } from "@/lib/validation/investments";

export type AnalyzeResult =
  | { ok: false; error: string }
  | { ok: true; report: ReturnType<typeof analyzeStatement>; cardNickname: string };

/**
 * Parses the uploaded statement CSV in memory and reports what it earned
 * on the chosen card vs what the wallet's best cards would have earned.
 * Nothing here is written to the database — the CSV is never persisted.
 */
export async function analyzeCsv(formData: FormData): Promise<AnalyzeResult> {
  const userId = await requireUserId();

  const cardId = String(formData.get("cardId") ?? "");
  // Every card in the wallet must belong to this user, and the used card
  // must be one of them — scoping the query to userId is what verifies
  // ownership before any card is used in the analysis.
  const cards = await prisma.creditCard.findMany({ where: { userId } });
  const used = cards.find((c) => c.id === cardId);
  if (!used) return { ok: false, error: "Card not found" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file uploaded" };
  if (file.size > IMPORT_LIMITS.fileBytes) {
    return {
      ok: false,
      error: `CSV file is too large; maximum is ${Math.floor(IMPORT_LIMITS.fileBytes / (1024 * 1024))} MB`,
    };
  }

  const parsedMapping = csvMappingInput.safeParse({
    dateCol: formData.get("dateCol"),
    amountCol: formData.get("amountCol"),
    descriptionCol: formData.get("descriptionCol"),
    dateFormat: formData.get("dateFormat"),
    negate: formData.get("negate") ?? "false",
    hasHeader: formData.get("hasHeader") ?? "false",
  });
  if (!parsedMapping.success) {
    const issue = parsedMapping.error.issues[0];
    return { ok: false, error: `${issue.path.join(".")}: ${issue.message}` };
  }
  const mapping: ColumnMapping = parsedMapping.data;

  let rows: MappedRow[];
  try {
    rows = mapRows(parseCsv(await file.text()), mapping);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Parse failed" };
  }
  const spend = rows.filter((r): r is Extract<MappedRow, { date: string }> => !("error" in r));

  const defs: CardDef[] = cards.map((c) => ({
    id: c.id,
    nickname: c.nickname,
    network: c.network as CardDef["network"],
    annualFeeMinor: c.annualFeeMinor,
    rewards: c.rewards as unknown as CardRewards,
  }));
  const usedDef = defs.find((d) => d.id === cardId)!;
  const report = analyzeStatement(spend, usedDef, defs, new Date().toISOString().slice(0, 10));
  return { ok: true, report, cardNickname: used.nickname };
}
