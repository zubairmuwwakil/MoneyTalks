// Field-level helpers for EmailConnection's credential columns.
//
// Every call site goes through here so that the (userId, field) binding used as
// GCM additional data is constructed in exactly one place. Hand-rolling it at
// each route is how a binding silently ends up mismatched between write and read.

import {
  SecretCryptoError,
  decryptSecret,
  encryptSecret,
  type SecretField,
} from "./secretCrypto";

type MaybeSecret = string | null | undefined;

export type ConnectionSecrets = {
  accessToken?: MaybeSecret;
  refreshToken?: MaybeSecret;
};

/**
 * Encrypts whichever secrets are present, preserving `null` (clear the column)
 * and `undefined` (leave the column alone) so the result can be spread straight
 * into a Prisma `create`/`update` payload.
 */
export function encryptConnectionSecrets(userId: string, secrets: ConnectionSecrets): ConnectionSecrets {
  const out: ConnectionSecrets = {};
  for (const field of ["accessToken", "refreshToken"] as const) {
    if (!(field in secrets)) continue;
    const value = secrets[field];
    out[field] = typeof value === "string" && value.length > 0
      ? encryptSecret(value, { userId, field })
      : value;
  }
  return out;
}

/**
 * Decrypts a stored column for use in memory.
 *
 * Returns `null` when the credential is absent, still un-migrated plaintext, or
 * fails authentication — all of which mean "we have no usable credential", and
 * callers already handle that by asking the user to reconnect.
 *
 * Throws when the *deployment* is misconfigured (key missing or malformed).
 * That is not a user-data condition and must not be swallowed into a silent
 * "everyone is disconnected" outage.
 */
export function readConnectionSecret(userId: string, field: SecretField, stored: MaybeSecret): string | null {
  if (typeof stored !== "string" || stored.length === 0) return null;

  try {
    return decryptSecret(stored, { userId, field });
  } catch (err) {
    if (err instanceof SecretCryptoError) {
      if (err.code === "MISSING_KEY" || err.code === "INVALID_KEY" || err.code === "UNKNOWN_KEY_VERSION") {
        throw err;
      }
      // MALFORMED_ENVELOPE (legacy plaintext) or DECRYPT_FAILED (tampered/foreign).
      console.warn(`[secrets] unusable ${field} for user ${userId}: ${err.code}`);
      return null;
    }
    throw err;
  }
}
