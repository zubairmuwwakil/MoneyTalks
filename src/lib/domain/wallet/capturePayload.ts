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
  capturedAt: Date | null;
  capturedAtRaw: string;
  capturedTimezone: string | null;
  merchantRaw: string;
  transactionNameRaw: string | null;
  amount: string | null; // exact decimal string, ready for a Prisma Decimal column
  currency: string | null;
  cardRaw: string | null;
  latitude: number | null;
  longitude: number | null;
  locationAccuracyMeters: number | null;
}

export type WalletCaptureParseResult =
  | { ok: true; data: WalletCaptureData }
  | { ok: false; error: z.ZodError };

const envelopeSchema = z.object({
  schemaVersion: z.literal(1),
  shortcutVersion: z.coerce.number().int(),
  source: z.literal("apple_wallet_shortcuts"),
  eventId: z.string().min(1),
  capturedAt: z.string().min(1),
  timezone: z.string().nullable().optional(),
  transaction: z.unknown(),
  location: z.unknown().optional(),
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

function toDecimalString(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < MAX_AMOUNT_MAGNITUDE) {
    return String(v);
  }
  if (typeof v === "string") {
    // Shortcuts renders currency per device locale: "$6.42", "CA$1,234.56",
    // fr-CA "1 234,56 $". Strip symbols/spaces, then disambiguate the comma:
    // alongside a period it's a thousands separator; alone before 1-2 digits
    // it's a decimal comma; otherwise thousands.
    let s = v
      .replace(/[$€£¥]|CA\$|US\$|CAD|USD/gi, "")
      .replace(/[\s  ]/g, "")
      .trim();
    if (s.includes(",")) {
      if (s.includes(".")) s = s.replace(/,/g, "");
      else if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
      else s = s.replace(/,/g, "");
    }
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    if (Math.abs(Number(s)) >= MAX_AMOUNT_MAGNITUDE) return null;
    return s;
  }
  return null;
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
  const parsed = envelopeSchema.safeParse(trimKeys(rawBody));
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
      capturedAt: parseCapturedAt(env.capturedAt, capturedTimezone),
      capturedAtRaw: env.capturedAt,
      capturedTimezone,
      merchantRaw: transaction.data.merchantRaw,
      transactionNameRaw: optionalString(transaction.data.transactionNameRaw),
      amount: toDecimalString(transaction.data.amount),
      currency: optionalString(transaction.data.currency),
      cardRaw: optionalString(transaction.data.cardRaw),
      ...parseLocation(env.location),
    },
  };
}
