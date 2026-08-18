export function normalizeCurrencyCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized || null;
}

export function formatCurrencyCodeAmount(
  amountCents: number,
  currency: string | null | undefined,
): string {
  const amount = (amountCents / 100).toFixed(2);
  const code = normalizeCurrencyCode(currency);
  return code ? `${code} ${amount}` : `${amount} (currency unknown)`;
}
