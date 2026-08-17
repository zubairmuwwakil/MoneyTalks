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
  transaction: z.object({
    merchantRaw: z.string(),
    transactionNameRaw: z.unknown().optional(),
    amount: z.unknown().optional(),
    currency: z.unknown().optional(),
    cardRaw: z.unknown().optional(),
  }),
  location: z.unknown().optional(),
});

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
    const trimmed = v.trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
    if (Math.abs(Number(trimmed)) >= MAX_AMOUNT_MAGNITUDE) return null;
    return trimmed;
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
  const parsed = envelopeSchema.safeParse(rawBody);
  if (!parsed.success) return { ok: false, error: parsed.error };
  const env = parsed.data;

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
      merchantRaw: env.transaction.merchantRaw,
      transactionNameRaw: optionalString(env.transaction.transactionNameRaw),
      amount: toDecimalString(env.transaction.amount),
      currency: optionalString(env.transaction.currency),
      cardRaw: optionalString(env.transaction.cardRaw),
      ...parseLocation(env.location),
    },
  };
}
