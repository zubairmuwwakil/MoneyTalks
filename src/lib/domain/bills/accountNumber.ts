import "server-only";

import { decryptSecret, encryptSecret } from "@/lib/security/secretCrypto";

export interface ProtectedBillAccountNumber {
  encrypted: string;
  lastFour: string;
}

function accountContext(userId: string, billId: string) {
  return { userId, field: "billAccountNumber" as const, entityRef: billId };
}

export function accountNumberLastFour(value: string): string {
  const compact = value.replace(/[^\p{L}\p{N}]/gu, "");
  return compact.slice(-4);
}

export function protectBillAccountNumber(
  value: string,
  userId: string,
  billId: string,
): ProtectedBillAccountNumber {
  const plaintext = value.trim();
  if (!plaintext) throw new Error("Account number is empty.");
  return {
    encrypted: encryptSecret(plaintext, accountContext(userId, billId)),
    lastFour: accountNumberLastFour(plaintext),
  };
}

export function revealBillAccountNumber(encrypted: string, userId: string, billId: string): string {
  return decryptSecret(encrypted, accountContext(userId, billId));
}

export function maskBillAccountNumber(lastFour: string | null | undefined): string | null {
  if (!lastFour) return null;
  return `•••• ${lastFour}`;
}
