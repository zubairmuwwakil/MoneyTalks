/**
 * Cloudflare R2 Card Asset Sync Utility
 *
 * Uploads all card images from `public/cards/` to your Cloudflare R2 bucket.
 * Uses standard AWS SigV4 signed requests (zero additional dependencies required).
 *
 * Required environment variables:
 * - CLOUDFLARE_ACCOUNT_ID
 * - CLOUDFLARE_R2_ACCESS_KEY_ID
 * - CLOUDFLARE_R2_SECRET_ACCESS_KEY
 * - CLOUDFLARE_R2_BUCKET_NAME (e.g. 'moneytalks-cards')
 *
 * Usage:
 * npx dotenv -e .env.local -- npx tsx scripts/upload-cards-to-r2.ts
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY?.trim();
const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME?.trim();

if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
  console.error("Missing required Cloudflare R2 environment variables.");
  console.error("Please ensure the following are set in your environment / .env.local:");
  console.error("- CLOUDFLARE_ACCOUNT_ID");
  console.error("- CLOUDFLARE_R2_ACCESS_KEY_ID");
  console.error("- CLOUDFLARE_R2_SECRET_ACCESS_KEY");
  console.error("- CLOUDFLARE_R2_BUCKET_NAME");
  process.exit(1);
}

const endpointHost = `${accountId}.r2.cloudflarestorage.com`;
const cardsDir = path.join(process.cwd(), "public", "cards");

if (!fs.existsSync(cardsDir)) {
  console.error("No public/cards directory found. Run `npx tsx scripts/generate-starter-card-assets.ts` first.");
  process.exit(1);
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf-8").digest();
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Buffer {
  const kDate = hmacSha256(`AWS4${key}`, dateStamp);
  const kRegion = hmacSha256(kDate, regionName);
  const kService = hmacSha256(kRegion, serviceName);
  return hmacSha256(kService, "aws4_request");
}

async function uploadFile(fileName: string, fileData: Buffer, mimeType: string) {
  const dateObj = new Date();
  const amzDate = dateObj.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.substring(0, 8);
  const region = "auto";
  const service = "s3";

  const canonicalUri = `/${bucketName}/${fileName}`;
  const payloadHash = sha256Hex(fileData);

  const canonicalHeaders = `host:${endpointHost}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = getSignatureKey(secretAccessKey!, dateStamp, region, service);
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign, "utf-8").digest("hex");

  const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const uploadUrl = `https://${endpointHost}${canonicalUri}`;

  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Host: endpointHost,
      "Content-Type": mimeType,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      Authorization: authorizationHeader,
    },
    body: fileData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Upload failed for ${fileName}: HTTP ${response.status} - ${errorText}`);
  }

  console.log(`✓ Uploaded ${fileName} to R2 (${fileData.length} bytes)`);
}

async function main() {
  console.log(`Starting R2 sync from ${cardsDir} to bucket "${bucketName}"...`);
  const files = fs.readdirSync(cardsDir);

  let successCount = 0;
  for (const file of files) {
    if (file.startsWith(".")) continue;
    const filePath = path.join(cardsDir, file);
    const fileData = fs.readFileSync(filePath);
    const ext = path.extname(file).toLowerCase();
    const mimeType = ext === ".svg" ? "image/svg+xml" : ext === ".webp" ? "image/webp" : "image/png";

    try {
      await uploadFile(file, fileData, mimeType);
      successCount++;
    } catch (err) {
      console.error(`✗ Error uploading ${file}:`, err);
    }
  }

  console.log(`\nDone! Successfully synced ${successCount} assets to Cloudflare R2.`);
}

main().catch((err) => {
  console.error("Fatal upload error:", err);
  process.exit(1);
});
