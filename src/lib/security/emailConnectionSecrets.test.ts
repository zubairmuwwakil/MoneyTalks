import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";

import { encryptSecret } from "./secretCrypto";
import { encryptConnectionSecrets, readConnectionSecret } from "./emailConnectionSecrets";

process.env.SECRET_ENC_ACTIVE_VERSION = "1";
process.env.SECRET_ENC_KEY_V1 = randomBytes(32).toString("base64");

const USER = "user_123";

it("encrypts every present secret and leaves the rest untouched", () => {
  const out = encryptConnectionSecrets(USER, {
    accessToken: "ya29.access",
    refreshToken: null,
    imapPassword: undefined,
  });

  expect(String(out.accessToken)).toMatch(/^encv1:1:/);
  expect(out.refreshToken).toBe(null);
  expect(out.imapPassword).toBe(undefined);
});

it("never stores a secret under the wrong column's binding", () => {
  const out = encryptConnectionSecrets(USER, { accessToken: "value", imapPassword: "value" });

  // Same plaintext, different columns -> neither ciphertext is valid in the other's slot.
  expect(readConnectionSecret(USER, "accessToken", String(out.accessToken))).toBe("value");
  expect(readConnectionSecret(USER, "accessToken", String(out.imapPassword))).toBe(null);
});

it("reads back a secret written for the same user and column", () => {
  const stored = encryptSecret("s3cret", { userId: USER, field: "imapPassword" });
  expect(readConnectionSecret(USER, "imapPassword", stored)).toBe("s3cret");
});

it("treats a null column as simply absent", () => {
  expect(readConnectionSecret(USER, "refreshToken", null)).toBe(null);
  expect(readConnectionSecret(USER, "refreshToken", undefined)).toBe(null);
  expect(readConnectionSecret(USER, "refreshToken", "")).toBe(null);
});

it("treats un-migrated plaintext as absent rather than leaking it", () => {
  expect(readConnectionSecret(USER, "refreshToken", "1//0gBarePlaintextToken")).toBe(null);
});

it("treats a tampered or foreign ciphertext as absent, not as a crash", () => {
  const foreign = encryptSecret("someone-elses", { userId: "user_other", field: "refreshToken" });
  expect(readConnectionSecret(USER, "refreshToken", foreign)).toBe(null);
});

it("escalates a missing encryption key instead of silently degrading", () => {
  const stored = encryptSecret("s3cret", { userId: USER, field: "accessToken" });
  const saved = process.env.SECRET_ENC_KEY_V1;
  delete process.env.SECRET_ENC_KEY_V1;
  try {
    // A misconfigured deployment must be loud: this is not "user has no token".
    expect(() => readConnectionSecret(USER, "accessToken", stored)).toThrow(expect.objectContaining({ code: "UNKNOWN_KEY_VERSION" }));
  } finally {
    process.env.SECRET_ENC_KEY_V1 = saved;
  }
});
