export type Currency = "CAD" | "USD" | "JMD";

export function formatMinorUnits(
  amountMinor: number,
  currency: Currency,
  locale = "en-CA",
): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(
      `amountMinor must be a safe integer of minor units, got ${amountMinor}`,
    );
  }
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    amountMinor / 100,
  );
}
