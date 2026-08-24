import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeCurrencyCode } from "@/lib/utils/currency";

export const incompleteCaptureSelect = {
  id: true,
  capturedAt: true,
  source: true,
  schemaVersion: true,
  merchantRaw: true,
  transactionNameRaw: true,
  merchantNormalized: true,
  amountRaw: true,
  amountTextRaw: true,
  amountDeviceDecimal: true,
  amountDecodeStatus: true,
  amountDisagreement: true,
  currencyRaw: true,
  cardRaw: true,
  paymentMethodRaw: true,
  paymentMethodFallback: true,
  resolvedCardId: true,
  correctedMerchant: true,
  correctedAmount: true,
  correctedCurrency: true,
  correctedCardId: true,
  missingFields: true,
  walletInstallation: { select: { label: true } },
} satisfies Prisma.WalletEventSelect;

type IncompleteCaptureRow = Prisma.WalletEventGetPayload<{
  select: typeof incompleteCaptureSelect;
}>;

export type IncompleteCaptureEvidence = {
  id: string;
  capturedAt: string;
  sourceLabel: string;
  installationLabel: string;
  merchantHint: string | null;
  amountHint: string | null;
  currencyHint: string | null;
  cardHint: string | null;
  amountDisagreement: boolean;
  missing: Array<"merchant" | "amount" | "currency" | "card">;
  defaults: {
    merchant: string;
    amount: string;
    currency: string;
    cardId: string;
  };
};

function safeText(value: string | null | undefined, maxLength = 180): string | null {
  const cleaned = value?.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maxLength);
}

function missingKinds(row: IncompleteCaptureRow): IncompleteCaptureEvidence["missing"] {
  const raw = Array.isArray(row.missingFields)
    ? row.missingFields.filter((field): field is string => typeof field === "string")
    : [];
  const missing = new Set<IncompleteCaptureEvidence["missing"][number]>();
  if (raw.some((field) => field.startsWith("merchant"))) missing.add("merchant");
  if (raw.some((field) => field.startsWith("amount"))) missing.add("amount");
  if (raw.some((field) => field.startsWith("currency"))) missing.add("currency");
  if (raw.some((field) => field.startsWith("card") || field.startsWith("paymentMethod"))) missing.add("card");
  return [...missing];
}

/**
 * Deliberately small DTO for the authenticated recovery UI. In particular it
 * cannot expose rawPayload, clientMetadata, coordinates, or diagnostic blobs.
 */
export function toIncompleteCaptureEvidence(row: IncompleteCaptureRow): IncompleteCaptureEvidence {
  const merchantHint = safeText(row.merchantRaw ?? row.transactionNameRaw);
  const amountHint = safeText(
    row.amountTextRaw ?? row.amountDeviceDecimal?.toString() ?? row.amountRaw?.toString(),
    80,
  );
  const currencyHint = safeText(normalizeCurrencyCode(row.currencyRaw), 12);
  const cardHint = safeText(row.cardRaw ?? row.paymentMethodRaw);

  return {
    id: row.id,
    capturedAt: row.capturedAt.toISOString(),
    sourceLabel: row.schemaVersion >= 2 ? "Apple Wallet automation" : "Wallet Shortcut",
    installationLabel: safeText(row.walletInstallation.label, 80) ?? "Wallet installation",
    merchantHint,
    amountHint,
    currencyHint,
    cardHint,
    amountDisagreement: row.amountDisagreement,
    missing: missingKinds(row),
    defaults: {
      merchant: safeText(row.correctedMerchant ?? row.merchantNormalized ?? merchantHint) ?? "",
      amount: row.correctedAmount?.toString() ?? row.amountRaw?.toString() ?? "",
      currency: normalizeCurrencyCode(row.correctedCurrency ?? row.currencyRaw) ?? "",
      cardId: row.correctedCardId ?? row.resolvedCardId ?? "",
    },
  };
}

export async function listIncompleteCaptureEvidence(userId: string): Promise<IncompleteCaptureEvidence[]> {
  const rows = await prisma.walletEvent.findMany({
    where: { userId, processingStatus: "INCOMPLETE" },
    select: incompleteCaptureSelect,
    orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  return rows.map(toIncompleteCaptureEvidence);
}
