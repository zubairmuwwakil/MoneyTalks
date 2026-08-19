/**
 * Storage for BYOK upstream market-data credentials.
 *
 * These live here, encrypted, and never in MarketLens: MarketLens is a stateless
 * shared provider, and holding user credentials is exactly the personal-finance
 * territory it is not allowed to grow into. A key is decrypted only long enough
 * to be placed on a single outbound request header.
 *
 * Every call site goes through this module so the (userId, field) GCM binding is
 * built in one place, matching how EmailConnection's secrets are handled.
 */

import type { PrismaClient } from "@prisma/client";
import { SecretCryptoError, decryptSecret, encryptSecret } from "./secretCrypto";

/** Provider source names as MarketLens knows them. */
export const SUPPORTED_PROVIDERS = ["ALPHAVANTAGE", "QUESTRADE"] as const;
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

export function isSupportedProvider(value: string): value is SupportedProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(value.toUpperCase());
}

export async function saveProviderKey(
  prisma: PrismaClient,
  userId: string,
  provider: SupportedProvider,
  plaintextKey: string,
  label?: string,
): Promise<void> {
  const encryptedKey = encryptSecret(plaintextKey, { userId, field: "providerKey" });
  await prisma.providerCredential.upsert({
    where: { userId_provider: { userId, provider } },
    update: { encryptedKey, label: label ?? null, lastStatus: null },
    create: { userId, provider, encryptedKey, label: label ?? null },
  });
}

export async function deleteProviderKey(
  prisma: PrismaClient,
  userId: string,
  provider: SupportedProvider,
): Promise<void> {
  await prisma.providerCredential.deleteMany({ where: { userId, provider } });
}

/**
 * Decrypts every stored key for a user, for use on one outbound request.
 *
 * A credential that fails to decrypt is dropped rather than thrown, because the
 * consequence is a labelled downgrade — the request proceeds without that key and
 * the response reports `keySource: NONE` — not an outage. A *deployment*
 * misconfiguration (missing or malformed encryption key) still throws, so a
 * broken deploy cannot masquerade as "nobody has any keys".
 */
export async function readProviderKeys(
  prisma: PrismaClient,
  userId: string,
): Promise<Record<string, string>> {
  const rows = await prisma.providerCredential.findMany({
    where: { userId },
    select: { provider: true, encryptedKey: true },
  });

  const keys: Record<string, string> = {};
  for (const row of rows) {
    try {
      keys[row.provider] = decryptSecret(row.encryptedKey, { userId, field: "providerKey" });
    } catch (err) {
      if (
        err instanceof SecretCryptoError &&
        (err.code === "MISSING_KEY" || err.code === "INVALID_KEY" || err.code === "UNKNOWN_KEY_VERSION")
      ) {
        throw err;
      }
      console.warn(`[provider-keys] unusable ${row.provider} key for user ${userId}`);
    }
  }
  return keys;
}

/** Metadata for the settings screen. Never returns key material. */
export async function listProviderKeyStatus(prisma: PrismaClient, userId: string) {
  const rows = await prisma.providerCredential.findMany({
    where: { userId },
    select: { provider: true, label: true, createdAt: true, lastUsedAt: true, lastStatus: true },
    orderBy: { provider: "asc" },
  });
  return rows;
}
