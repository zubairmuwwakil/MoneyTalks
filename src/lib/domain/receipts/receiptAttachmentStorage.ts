import { get, put } from "@vercel/blob";
import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const LOCAL_SCHEME = "local-tmp://";
const LOCAL_HOST = "moneytalks-receipts";
const LOCAL_ROOT = path.join(os.tmpdir(), LOCAL_HOST);

function safeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_") || "attachment";
}

function safeSegment(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

/**
 * Stores private receipt content in Vercel Blob. A deliberately visible tmp
 * fallback keeps local development usable when no Blob store is configured.
 */
export async function storeReceiptAttachment(params: {
  userId: string;
  scopeId: string;
  filename: string;
  content: Buffer;
  contentType: string;
}): Promise<string> {
  const filename = safeFilename(params.filename);
  const pathname = `receipts/${safeSegment(params.userId)}/${safeSegment(params.scopeId)}/${randomUUID()}-${filename}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(pathname, params.content, {
      access: "private",
      addRandomSuffix: false,
      contentType: params.contentType,
    });
    return blob.url;
  }

  if (process.env.NODE_ENV !== "development") {
    throw new Error("BLOB_READ_WRITE_TOKEN is required for receipt storage outside local development.");
  }

  const localPath = path.join(LOCAL_ROOT, ...pathname.split("/"));
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, params.content);
  console.warn(`[local tmp fallback] BLOB_READ_WRITE_TOKEN is unset; receipt stored at ${LOCAL_SCHEME}${LOCAL_HOST}/${pathname}`);
  return `${LOCAL_SCHEME}${LOCAL_HOST}/${pathname}`;
}

type StoredAttachment = {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
};

function localPathFor(storagePath: string) {
  const url = new URL(storagePath);
  if (url.protocol !== "local-tmp:" || url.hostname !== LOCAL_HOST) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some(segment => segment === "." || segment === "..")) return null;
  return path.join(LOCAL_ROOT, ...segments);
}

/** Reads content only after the caller has established ownership. */
export async function readReceiptAttachment(storagePath: string): Promise<StoredAttachment | null> {
  if (storagePath.startsWith(LOCAL_SCHEME)) {
    const localPath = localPathFor(storagePath);
    if (!localPath) return null;
    try {
      const content = await fs.readFile(/* turbopackIgnore: true */ localPath);
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(content);
            controller.close();
          },
        }),
        contentType: "application/octet-stream",
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required to read Vercel Blob attachments.");
  }

  const blob = await get(storagePath, { access: "private" });
  if (!blob || blob.statusCode !== 200 || !blob.stream) return null;
  return { stream: blob.stream, contentType: blob.blob.contentType };
}
