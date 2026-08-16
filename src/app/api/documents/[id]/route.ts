import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { readReceiptAttachment } from "@/lib/domain/receipts/receiptAttachmentStorage";

export const runtime = "nodejs";

function downloadName(filename: string) {
  return filename.replace(/[\r\n"]/g, "_") || "document";
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const [receiptDocument, receiptUpload, purchaseAttachment] = await Promise.all([
    prisma.receiptDocument.findFirst({ where: { id, userId }, select: { filename: true, contentType: true, storagePath: true } }),
    prisma.receiptUpload.findFirst({ where: { id, userId }, select: { filename: true, contentType: true, storagePath: true } }),
    prisma.purchaseAttachment.findFirst({
      where: { id, purchase: { userId } },
      select: { storageKey: true, mime: true },
    }),
  ]);

  const document = receiptDocument
    ? { filename: receiptDocument.filename, contentType: receiptDocument.contentType, storagePath: receiptDocument.storagePath }
    : receiptUpload
      ? { filename: receiptUpload.filename, contentType: receiptUpload.contentType, storagePath: receiptUpload.storagePath }
      : purchaseAttachment
        ? { filename: "receipt-attachment", contentType: purchaseAttachment.mime ?? "application/octet-stream", storagePath: purchaseAttachment.storageKey }
        : null;
  if (!document) return new NextResponse("Not found", { status: 404 });

  try {
    const attachment = await readReceiptAttachment(document.storagePath);
    if (!attachment) return new NextResponse("Document storage object not found", { status: 404 });
    return new NextResponse(attachment.stream, {
      headers: {
        "Content-Type": document.contentType || attachment.contentType,
        "Content-Disposition": `attachment; filename="${downloadName(document.filename)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Unable to read document attachment", error);
    return NextResponse.json({ error: "Document storage is unavailable. Check BLOB_READ_WRITE_TOKEN." }, { status: 503 });
  }
}
