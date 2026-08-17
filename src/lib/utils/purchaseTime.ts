import { DateTime } from "luxon";

// Display timezone for purchase timestamps. A wallet capture carries the
// timezone the user was actually in; everything else falls back to the
// ledger zone until per-user home timezones exist.
const FALLBACK_ZONE = "America/Toronto";

export function purchaseLocalDateTime(at: Date, timezone?: string | null): DateTime {
  const zoned = DateTime.fromJSDate(at).setZone(timezone ?? FALLBACK_ZONE);
  return zoned.isValid ? zoned : DateTime.fromJSDate(at).setZone(FALLBACK_ZONE);
}
