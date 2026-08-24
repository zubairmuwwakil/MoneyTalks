import { DateTime, IANAZone } from "luxon";
import { z } from "zod";

// Tolerant parsing for the Wallet Shortcut payload. The Shortcut is a dumb
// transport on a device we can't patch, so every awkward serialization it
// produces (numeric strings, location as a JSON string, Shortcuts-native
// dictionary keys, empty strings for missing values) is absorbed here.
// Metadata problems degrade to null; they never cost us the transaction.

export interface WalletCaptureData {
  eventId: string;
  source: string;
  schemaVersion: number;
  shortcutVersion: number;
  captureVersion: number | null;
  transport: string | null;
  capturedAt: Date | null;
  capturedAtRaw: string;
  capturedTimezone: string | null;
  merchantRaw: string | null;
  transactionNameRaw: string | null;
  /** Canonical exact decimal string, preferring the device decode for schema 2. */
  amount: string | null;
  /** Verbatim Apple-supplied text. Schema 1 cannot always preserve this outside rawPayload. */
  amountTextRaw: string | null;
  amountDeviceDecimal: string | null;
  amountDecodeStatus: "decoded" | "undecodable" | "absent";
  amountDisagreement: boolean;
  currency: string | null;
  cardRaw: string | null;
  paymentMethodRaw: string | null;
  paymentMethodFallback: boolean;
  latitude: number | null;
  longitude: number | null;
  locationAccuracyMeters: number | null;
  locationCapturedAt: Date | null;
  client: Record<string, string | number | boolean | null> | null;
}

export type WalletCaptureParseResult =
  | { ok: true; data: WalletCaptureData }
  | { ok: false; error: z.ZodError };

const schema1Envelope = z.object({
  schemaVersion: z.literal(1),
  shortcutVersion: z.coerce.number().int(),
  source: z.literal("apple_wallet_shortcuts"),
  eventId: z.string().min(1),
  capturedAt: z.string().min(1),
  timezone: z.string().nullable().optional(),
  transaction: z.unknown(),
  location: z.unknown().optional(),
});

const schema2Envelope = z.object({
  schemaVersion: z.literal(2),
  captureVersion: z.coerce.number().int().positive(),
  source: z.literal("apple_wallet_automation"),
  transport: z.literal("pickme_app_intent"),
  eventId: z.string().min(1),
  capturedAt: z.string().min(1),
  timezone: z.string().nullable().optional(),
  transaction: z.object({
    merchantRaw: z.unknown().optional(),
    transactionNameRaw: z.unknown().optional(),
    amountRaw: z.unknown().optional(),
    amountDecimal: z.unknown().optional(),
    amountDecodeStatus: z.enum(["decoded", "undecodable", "absent"]),
    currencyRaw: z.unknown().optional(),
    cardRaw: z.unknown().optional(),
    paymentMethodRaw: z.unknown().optional(),
  }),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    horizontalAccuracyMeters: z.number().nonnegative(),
    capturedAt: z.string().min(1),
  }).optional(),
  client: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

const transactionSchema = z.object({
  merchantRaw: z.string(),
  transactionNameRaw: z.unknown().optional(),
  amount: z.unknown().optional(),
  currency: z.unknown().optional(),
  cardRaw: z.unknown().optional(),
});

// Hand-typed dictionary keys on a phone often carry invisible trailing
// spaces ("location ") — trim keys everywhere before validating. rawPayload
// still stores the body exactly as received.
function trimKeys(value: unknown): unknown {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key.trim(), trimKeys(nested)]),
  );
}

// Shortcuts can only nest a dictionary variable into another dictionary as
// text, which renders it as a JSON string — accept that shape too, exactly
// like location.
function parseTransaction(raw: unknown):
  | { ok: true; data: z.infer<typeof transactionSchema> }
  | { ok: false; error: z.ZodError } {
  let candidate: unknown = raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    try {
      candidate = JSON.parse(raw.trim());
    } catch {
      // fall through; schema validation below reports the failure
    }
  }
  const parsed = transactionSchema.safeParse(trimKeys(candidate));
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: parsed.error };
}

function optionalString(v: unknown): string | null {
  if (typeof v !== "string" || v === "") return null;
  return v;
}

// numeric(15,4) holds 11 integer digits; anything larger is garbage, not money.
const MAX_AMOUNT_MAGNITUDE = 1e11;

function isSafeDecimal(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value)
    && Number.isFinite(Number(value))
    && Math.abs(Number(value)) < MAX_AMOUNT_MAGNITUDE;
}

/** Schema 2 carries this as a machine value, never a localized display string. */
function toCanonicalDecimalString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const value = v.trim();
  return isSafeDecimal(value) ? value : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * ICU supplies the region-specific currency labels (for example, `EC$` for
 * XCD). Schema 1 did not include a locale, so stable Caribbean/North American
 * fallbacks complement the ISO code without ever accepting arbitrary text.
 */
function currencyTokens(currency: string | null, locale?: string | null): string[] {
  const code = currency?.trim().toUpperCase();
  if (!code || !/^[A-Z]{3}$/.test(code)) return [];

  const locales = [...new Set([locale, "en-US", "en-CA", "en-LC"].filter((value): value is string => Boolean(value)))];
  const tokens = new Set<string>([code]);
  for (const candidateLocale of locales) {
    for (const currencyDisplay of ["symbol", "narrowSymbol", "code"] as const) {
      try {
        const parts = new Intl.NumberFormat(candidateLocale, {
          style: "currency",
          currency: code,
          currencyDisplay,
        }).formatToParts(0);
        for (const part of parts) if (part.type === "currency" && part.value) tokens.add(part.value);
      } catch {
        // A malformed client locale must leave the amount undecodable rather
        // than cause us to invent a plausible financial value.
      }
    }
  }
  return [...tokens].sort((left, right) => right.length - left.length);
}

function toDecimalString(v: unknown, currency: string | null = null, locale?: string | null): string | null {
  if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < MAX_AMOUNT_MAGNITUDE) {
    return String(v);
  }
  if (typeof v === "string") {
    // Shortcuts renders currency per device locale: "$6.42", "CA$1,234.56",
    // fr-CA "1 234,56 $". Strip symbols/spaces, then disambiguate the comma:
    // alongside a period it's a thousands separator; alone before 1-2 digits
    // it's a decimal comma; otherwise thousands.
    let s = v.trim()
      // These were accepted before schema 1 carried Currency Code reliably.
      // Remove multi-character labels before a generic `$` can split them.
      .replace(/CA\$|US\$|CAD|USD/gi, "");
    for (const token of currencyTokens(currency, locale)) {
      s = s.replace(new RegExp(escapeRegExp(token), "gi"), "");
    }
    // Retain compatibility for old captures that omitted Currency Code. A
    // region-qualified label such as EC$ is only accepted with its ISO code.
    s = s
      .replace(/[$€£¥]/g, "")
      .replace(/[\s  ]/g, "")
      .trim();
    if (s.includes(",")) {
      if (s.includes(".")) s = s.replace(/,/g, "");
      else if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
      else s = s.replace(/,/g, "");
    }
    return isSafeDecimal(s) ? s : null;
  }
  return null;
}

function decimalDiffers(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return false;
  const left = Number(a);
  const right = Number(b);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) > 0.00005;
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Case/spacing-insensitive key lookup so both the payload contract's
// `latitude` and Shortcuts' native `Latitude` / `Horizontal Accuracy` work.
function pickKey(obj: Record<string, unknown>, ...normalizedNames: string[]): unknown {
  for (const key of Object.keys(obj)) {
    const normalized = key.toLowerCase().replace(/[\s_]/g, "");
    if (normalizedNames.includes(normalized)) return obj[key];
  }
  return undefined;
}

function parseLocation(raw: unknown): Pick<WalletCaptureData, "latitude" | "longitude" | "locationAccuracyMeters"> {
  const none = { latitude: null, longitude: null, locationAccuracyMeters: null };
  let candidate: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return none;
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      return none;
    }
  }
  if (candidate == null || typeof candidate !== "object" || Array.isArray(candidate)) return none;
  const rec = candidate as Record<string, unknown>;

  const latitude = toFiniteNumber(pickKey(rec, "latitude"));
  const longitude = toFiniteNumber(pickKey(rec, "longitude"));
  if (latitude == null || longitude == null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return none;
  }
  const accuracy = toFiniteNumber(pickKey(rec, "horizontalaccuracymeters", "horizontalaccuracy"));
  return {
    latitude,
    longitude,
    locationAccuracyMeters: accuracy != null && accuracy >= 0 ? accuracy : null,
  };
}

function parseCapturedAt(rawString: string, zone: string | null): Date | null {
  // The zone only applies when the string carries no offset of its own.
  const opts = zone ? { zone } : {};
  let dt = DateTime.fromISO(rawString, { setZone: true, ...opts });
  if (!dt.isValid) dt = DateTime.fromSQL(rawString, opts);
  return dt.isValid ? dt.toJSDate() : null;
}

export function parseWalletCapturePayload(rawBody: unknown): WalletCaptureParseResult {
  const trimmed = trimKeys(rawBody);
  const version = typeof trimmed === "object" && trimmed != null && !Array.isArray(trimmed)
    ? (trimmed as Record<string, unknown>).schemaVersion
    : undefined;

  if (version === 2) {
    const parsed = schema2Envelope.safeParse(trimmed);
    if (!parsed.success) return { ok: false, error: parsed.error };
    const env = parsed.data;
    const rawAmount = optionalString(env.transaction.amountRaw);
    const currency = optionalString(env.transaction.currencyRaw);
    const clientLocale = typeof env.client?.locale === "string" ? env.client.locale : null;
    const deviceAmount = toCanonicalDecimalString(env.transaction.amountDecimal);
    const serverAmount = toDecimalString(rawAmount, currency, clientLocale);
    // `amountDecimal` is the v2 source of truth. A malformed machine value is
    // recoverable through its retained raw text, but must never be promoted as
    // a plausible purchase by falling back to formatted display text.
    const status = env.transaction.amountDecodeStatus === "decoded" && deviceAmount == null
      ? "undecodable"
      : env.transaction.amountDecodeStatus;
    const canonicalAmount = status === "decoded" ? deviceAmount : null;
    const transactionNameRaw = optionalString(env.transaction.transactionNameRaw);
    const observedPaymentMethod = optionalString(env.transaction.paymentMethodRaw);
    const paymentMethodFallback = observedPaymentMethod != null && observedPaymentMethod === transactionNameRaw;
    const capturedTimezone = env.timezone != null && IANAZone.isValidZone(env.timezone) ? env.timezone : null;

    return {
      ok: true,
      data: {
        eventId: env.eventId,
        source: env.source,
        schemaVersion: 2,
        shortcutVersion: 0,
        captureVersion: env.captureVersion,
        transport: env.transport,
        capturedAt: parseCapturedAt(env.capturedAt, capturedTimezone),
        capturedAtRaw: env.capturedAt,
        capturedTimezone,
        merchantRaw: optionalString(env.transaction.merchantRaw),
        transactionNameRaw,
        amount: canonicalAmount,
        amountTextRaw: rawAmount,
        amountDeviceDecimal: deviceAmount,
        amountDecodeStatus: status,
        amountDisagreement: decimalDiffers(deviceAmount, serverAmount),
        currency,
        cardRaw: optionalString(env.transaction.cardRaw),
        paymentMethodRaw: paymentMethodFallback ? null : observedPaymentMethod,
        paymentMethodFallback,
        latitude: env.location?.latitude ?? null,
        longitude: env.location?.longitude ?? null,
        locationAccuracyMeters: env.location?.horizontalAccuracyMeters ?? null,
        locationCapturedAt: env.location ? parseCapturedAt(env.location.capturedAt, capturedTimezone) : null,
        client: env.client ?? null,
      },
    };
  }

  const parsed = schema1Envelope.safeParse(trimmed);
  if (!parsed.success) return { ok: false, error: parsed.error };
  const env = parsed.data;

  const transaction = parseTransaction(env.transaction);
  if (!transaction.ok) return { ok: false, error: transaction.error };

  const capturedTimezone =
    env.timezone != null && IANAZone.isValidZone(env.timezone) ? env.timezone : null;

  return {
    ok: true,
    data: {
      eventId: env.eventId,
      source: env.source,
      schemaVersion: env.schemaVersion,
      shortcutVersion: env.shortcutVersion,
      captureVersion: null,
      transport: null,
      capturedAt: parseCapturedAt(env.capturedAt, capturedTimezone),
      capturedAtRaw: env.capturedAt,
      capturedTimezone,
      merchantRaw: transaction.data.merchantRaw,
      transactionNameRaw: optionalString(transaction.data.transactionNameRaw),
      amount: toDecimalString(transaction.data.amount, optionalString(transaction.data.currency)),
      amountTextRaw: optionalString(transaction.data.amount),
      amountDeviceDecimal: null,
      amountDecodeStatus: transaction.data.amount == null || transaction.data.amount === ""
        ? "absent" : (toDecimalString(transaction.data.amount, optionalString(transaction.data.currency)) == null ? "undecodable" : "decoded"),
      amountDisagreement: false,
      currency: optionalString(transaction.data.currency),
      cardRaw: optionalString(transaction.data.cardRaw),
      paymentMethodRaw: null,
      paymentMethodFallback: false,
      ...parseLocation(env.location),
      locationCapturedAt: null,
      client: null,
    },
  };
}
