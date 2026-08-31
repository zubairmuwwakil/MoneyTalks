import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyNotionWebhookSignature(
  rawBody: string,
  signature: string | null,
  verificationToken: string,
): boolean {
  if (!signature) return false;
  const expected = `sha256=${createHmac("sha256", verificationToken).update(rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(signature, "utf8");
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
