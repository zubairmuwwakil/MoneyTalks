import { prisma } from "@/lib/prisma";

export const WALLET_DIAGNOSTIC_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function deleteExpiredWalletDiagnostics(now = new Date()) {
  return prisma.walletCaptureDiagnostic.deleteMany({ where: { expiresAt: { lte: now } } });
}
