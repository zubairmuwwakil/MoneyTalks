// Shared guard for /api/cron/*. These routes are exempt from Clerk in
// src/middleware.ts, so this is the ONLY thing standing between the public
// internet and bulk email sends. It fails closed by design: an unset
// CRON_SECRET denies every request rather than waving them all through.

import { secretEquals } from "./secretCrypto";

type HeaderBearing = { headers: { get(name: string): string | null } };

export function isAuthorizedCronRequest(req: HeaderBearing): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  // External schedulers send x-cron-secret; Vercel Cron sends Authorization: Bearer.
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const presented = req.headers.get("x-cron-secret")?.trim() || bearer?.trim();
  if (!presented) return false;

  return secretEquals(presented, secret);
}
