// Shared guard for /api/cron/*. These routes are exempt from Clerk in
// src/proxy.ts, so this is the ONLY thing standing between the public internet
// and bulk email sends. It accepts QStash-signed requests and keeps the older
// CRON_SECRET header path as a manual/external-scheduler fallback.

import { Receiver } from "@upstash/qstash";
import { secretEquals } from "./secretCrypto";

type HeaderBearing = { headers: { get(name: string): string | null } };
type CronRequest = HeaderBearing & { clone?: () => { text: () => Promise<string> } };

function isAuthorizedSharedSecretRequest(req: HeaderBearing): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  // External schedulers send x-cron-secret; Vercel Cron sends Authorization: Bearer.
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const presented = req.headers.get("x-cron-secret")?.trim() || bearer?.trim();
  if (!presented) return false;

  return secretEquals(presented, secret);
}

async function isAuthorizedQstashRequest(req: CronRequest): Promise<boolean> {
  const signature = req.headers.get("upstash-signature");
  if (!signature || !req.clone) return false;

  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY?.trim();
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY?.trim();
  if (!currentSigningKey && !nextSigningKey && !process.env.QSTASH_REGION) return false;

  try {
    const receiver = new Receiver({ currentSigningKey, nextSigningKey });
    await receiver.verify({
      signature,
      body: await req.clone().text(),
      clockTolerance: 30,
      upstashRegion: req.headers.get("upstash-region") ?? undefined,
    });
    return true;
  } catch {
    return false;
  }
}

export async function isAuthorizedCronRequest(req: CronRequest): Promise<boolean> {
  if (isAuthorizedSharedSecretRequest(req)) return true;
  return isAuthorizedQstashRequest(req);
}
