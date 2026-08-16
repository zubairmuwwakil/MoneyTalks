import { promises as fs } from "fs";
import path from "path";

/**
 * Save email attachment to local filesystem
 * Files stored at: public/receipts/[userId]/[emailTransactionId]/[filename]
 * Returns storagePath URL: /receipts/[userId]/[emailTransactionId]/[filename]
 */
export async function saveReceiptAttachment(
  userId: string,
  emailTransactionId: string,
  filename: string,
  content: Buffer
): Promise<string> {
  // Create directory structure: public/receipts/userId/transactionId/
  const receiptDir = path.join(process.cwd(), "public", "receipts", userId, emailTransactionId);
  
  try {
    await fs.mkdir(receiptDir, { recursive: true });
  } catch (error) {
    console.error("Failed to create receipt directory:", error);
    throw error;
  }

  // Sanitize filename to prevent path traversal
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filepath = path.join(receiptDir, sanitizedFilename);

  try {
    await fs.writeFile(filepath, content);
  } catch (error) {
    console.error("Failed to write receipt file:", error);
    throw error;
  }

  // Return relative URL path
  return `/receipts/${userId}/${emailTransactionId}/${sanitizedFilename}`;
}

/**
 * Delete all receipts for a transaction
 */
export async function deleteReceiptAttachments(userId: string, emailTransactionId: string): Promise<void> {
  const receiptDir = path.join(process.cwd(), "public", "receipts", userId, emailTransactionId);

  try {
    await fs.rm(receiptDir, { recursive: true, force: true });
  } catch (error) {
    console.error("Failed to delete receipt attachments:", error);
    // Don't throw, just log - this is cleanup
  }
}
