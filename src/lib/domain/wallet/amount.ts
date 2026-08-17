import { Prisma } from "@prisma/client";

// Single conversion point from the WalletEvent.amountRaw Decimal to the minor
// units used everywhere downstream (Purchase.totalCents, cap accrual).
export function walletAmountMinor(amountRaw: Prisma.Decimal | null): number | null {
  if (amountRaw == null) return null;
  return amountRaw.times(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}
