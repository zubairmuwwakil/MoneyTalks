export type Currency = "CAD" | "USD" | "JMD";

/**
 * Parses a dollar amount typed by a human — "$1,234.56", "(45.00)", "-12" — into
 * signed integer cents. Returns null for anything that doesn't parse. Shared by the
 * CSV importer and every dollars-entry form field, so the app has exactly one place
 * that turns free-text money into minor units.
 */
export function parseDollarsToMinor(raw: string): number | null {
  let s = raw.trim().replace(/[$,\s]/g, "");
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [dollars, cents = ""] = s.split(".");
  const minor = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}

/**
 * Renders a stored cents value for a dollars-entry `<input>` — plain "1234.56", no
 * currency symbol or thousands grouping, so it round-trips through parseDollarsToMinor.
 */
export function minorToDollarInput(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const dollars = Math.trunc(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${dollars}.${cents}`;
}

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
