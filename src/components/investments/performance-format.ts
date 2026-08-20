import { formatMinorUnits, type Currency } from "@/engine/money";

export function formatSignedMinor(amountMinor: number | null, currency: Currency): string {
  if (amountMinor === null) return "—";
  const value = formatMinorUnits(Math.abs(amountMinor), currency);
  if (amountMinor > 0) return `+${value}`;
  if (amountMinor < 0) return `-${value}`;
  return value;
}

export function formatSignedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const percent = `${Math.abs(value * 100).toFixed(1)}%`;
  if (value > 0) return `+${percent}`;
  if (value < 0) return `-${percent}`;
  return percent;
}
