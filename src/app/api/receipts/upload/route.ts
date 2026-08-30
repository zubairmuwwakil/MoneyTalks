//upload api route (stores file + creates AutomationSuggestion)

import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { normalizeCurrencyCode } from "@/lib/utils/currency";
import {
  parseReceiptUpload,
  RECEIPT_UPLOAD_EXTRACTOR_VERSION,
} from "@/lib/domain/receipts/uploadedReceiptParser";
import { storeReceiptAttachment } from "@/lib/domain/receipts/receiptAttachmentStorage";
import crypto from "crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const defaultReturnDays = Number(form.get("defaultReturnDays") ?? 30);

  const bytes = Buffer.from(await file.arrayBuffer());
  const filename = file.name || "receipt";
  const contentType = file.type || "application/octet-stream";

  let storagePath: string;
  try {
    storagePath = await storeReceiptAttachment({
      userId,
      scopeId: `upload-${crypto.randomUUID()}`,
      filename,
      content: bytes,
      contentType,
    });
  } catch (error) {
    console.error("Receipt upload storage failed", error);
    return NextResponse.json({ error: "Receipt storage failed. Check BLOB_READ_WRITE_TOKEN or the local tmp fallback." }, { status: 503 });
  }

  // parse & extract
  let parsed;
  try {
    parsed = await parseReceiptUpload({
      buffer: bytes,
      contentType,
      filename,
      defaultReturnDays: Number.isFinite(defaultReturnDays) ? defaultReturnDays : 30,
    });
  } catch (e: unknown) {
    const rec = await prisma.receiptUpload.create({
      data: {
        userId,
        filename,
        contentType,
        sizeBytes: bytes.length,
        storagePath,
        status: "FAILED",
        extractorVersion: RECEIPT_UPLOAD_EXTRACTOR_VERSION,
        error: e instanceof Error ? e.message : String(e),
      },
    });

    return NextResponse.json({ error: "Parse failed", receiptId: rec.id }, { status: 400 });
  }

  // save receipt upload record
  const receipt = await prisma.receiptUpload.create({
    data: {
      userId,
      filename,
      contentType,
      sizeBytes: bytes.length,
      storagePath,
      status: parsed.confidence === "LOW" ? "NEEDS_REVIEW" : "PARSED",
      extractorVersion: RECEIPT_UPLOAD_EXTRACTOR_VERSION,
      extracted: parsed.extracted,
    },
  });

  const purchase = await prisma.purchase.upsert({
    where: { userId_sourceEmailId: { userId, sourceEmailId: receipt.id } },
    create: {
      userId,
      merchant: parsed.merchant,
      totalCents: parsed.amountCents ?? null,
      currency: normalizeCurrencyCode(parsed.currency),
      purchasedAt: new Date(parsed.purchaseDate + "T00:00:00.000Z"),
      orderNumber: null,
      paymentMethod: null,
      source: "UPLOAD",
      sourceEmailId: receipt.id,
    },
    update: {
      merchant: parsed.merchant,
      totalCents: parsed.amountCents ?? null,
      currency: normalizeCurrencyCode(parsed.currency),
      purchasedAt: new Date(parsed.purchaseDate + "T00:00:00.000Z"),
    },
  });

  await prisma.purchaseAttachment.createMany({
    data: [
      {
        purchaseId: purchase.id,
        storageKey: storagePath,
        mime: contentType,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        sourceEmailId: receipt.id,
      },
    ],
    skipDuplicates: true,
  });

  // create NEW suggestion (defaults to RETURN, user can change type in Inbox Review)
  const suggestion = await prisma.automationSuggestion.create({
    data: {
      userId,
      provider: "UPLOAD",
      primaryMessageId: receipt.id, // reuse column as stable dedupe key
      type: "RETURN",
      status: "NEW",
      merchant: parsed.merchant,
      amountCents: parsed.amountCents ?? null,
      currency: normalizeCurrencyCode(parsed.currency),
      detectedDate: new Date(parsed.purchaseDate + "T00:00:00.000Z"),
      confidence: parsed.confidence,
      reasons: parsed.reasons,
      messageIds: [receipt.id],
      draft: {
        purchaseDate: parsed.purchaseDate,
        returnWindowDays: parsed.returnWindowDays,
        returnBy: parsed.returnBy,
        receiptUploadId: receipt.id,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    receiptId: receipt.id,
    purchaseId: purchase.id,
    suggestionId: suggestion.id,
  });
}
