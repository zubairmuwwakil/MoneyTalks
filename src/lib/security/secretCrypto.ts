// Authenticated encryption for credentials held at rest (OAuth tokens, IMAP passwords).
//
// Envelope format:  encv1:<keyVersion>:<base64url(iv ‖ authTag ‖ ciphertext)>
//
// Two deliberate properties:
//   - Fails closed. A missing or malformed key throws; nothing is ever stored or
//     read as plaintext because of a configuration mistake.
//   - Binds ciphertext to its location via GCM additional authenticated data, so a
//     value lifted from one row/column cannot be replayed into another.

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

export type SecretField = "accessToken" | "refreshToken" | "imapPassword";
export type SecretContext = { userId: string; field: SecretField };

export type SecretCryptoCode =
  | "MISSING_KEY"
  | "INVALID_KEY"
  | "UNKNOWN_KEY_VERSION"
  | "MALFORMED_ENVELOPE"
  | "DECRYPT_FAILED";

export class SecretCryptoError extends Error {
  readonly code: SecretCryptoCode;
  constructor(code: SecretCryptoCode, message: string) {
    super(message);
    this.name = "SecretCryptoError";
    this.code = code;
  }
}

const FORMAT = "encv1";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function keyEnvVar(version: number): string {
  return `SECRET_ENC_KEY_V${version}`;
}

function loadKey(version: number, code: SecretCryptoCode): Buffer {
  const raw = process.env[keyEnvVar(version)];
  if (!raw) {
    throw new SecretCryptoError(code, `${keyEnvVar(version)} is not set. Credential encryption cannot proceed.`);
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new SecretCryptoError(
      "INVALID_KEY",
      `${keyEnvVar(version)} must decode to ${KEY_BYTES} bytes, got ${key.length}. Generate one with: openssl rand -base64 32`
    );
  }
  return key;
}

function activeVersion(): number {
  const raw = process.env.SECRET_ENC_ACTIVE_VERSION;
  const version = Number(raw);
  if (!raw || !Number.isInteger(version) || version < 1) {
    throw new SecretCryptoError(
      "MISSING_KEY",
      "SECRET_ENC_ACTIVE_VERSION must be set to a positive integer naming the active key version."
    );
  }
  return version;
}

// Bound into the GCM tag: the ciphertext only authenticates for the exact
// user and column it was written for.
function aad(ctx: SecretContext): Buffer {
  return Buffer.from(`${FORMAT}|${ctx.userId}|${ctx.field}`, "utf8");
}

export function isEnvelope(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(`${FORMAT}:`);
}

export function encryptSecret(plaintext: string, ctx: SecretContext): string {
  const version = activeVersion();
  const key = loadKey(version, "MISSING_KEY");

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad(ctx));

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);

  return `${FORMAT}:${version}:${payload.toString("base64url")}`;
}

export function decryptSecret(envelope: string, ctx: SecretContext): string {
  if (!isEnvelope(envelope)) {
    throw new SecretCryptoError(
      "MALFORMED_ENVELOPE",
      "Value is not an encrypted envelope. Legacy plaintext must be migrated, never read directly."
    );
  }

  const parts = envelope.split(":");
  if (parts.length !== 3) {
    throw new SecretCryptoError("MALFORMED_ENVELOPE", `Expected 3 envelope segments, got ${parts.length}.`);
  }

  const version = Number(parts[1]);
  if (!Number.isInteger(version) || version < 1) {
    throw new SecretCryptoError("MALFORMED_ENVELOPE", `Envelope key version "${parts[1]}" is not a positive integer.`);
  }

  const key = loadKey(version, "UNKNOWN_KEY_VERSION");

  const payload = Buffer.from(parts[2], "base64url");
  if (payload.length <= IV_BYTES + TAG_BYTES) {
    throw new SecretCryptoError("MALFORMED_ENVELOPE", "Envelope payload is too short to contain IV, tag and ciphertext.");
  }

  const decipher = createDecipheriv(ALGORITHM, key, payload.subarray(0, IV_BYTES));
  decipher.setAAD(aad(ctx));
  decipher.setAuthTag(payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));

  try {
    return Buffer.concat([
      decipher.update(payload.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key, tampered bytes, or a value written for a different user/column.
    // Never distinguish between these to the caller.
    throw new SecretCryptoError("DECRYPT_FAILED", "Credential failed authentication and cannot be trusted.");
  }
}

/** Constant-time comparison for shared secrets supplied by callers. */
export function secretEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
