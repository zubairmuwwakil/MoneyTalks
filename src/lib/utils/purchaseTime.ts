import { DateTime } from "luxon";

// Display timezone for purchase timestamps. A wallet capture carries the
// timezone the user was actually in; everything else falls back to the
// user's home timezone (NotificationPreference.timezone), then the ledger zone.
const FALLBACK_ZONE = "America/Toronto";

export function purchaseLocalDateTime(
  at: Date,
  timezone?: string | null,
  homeZone?: string | null,
): DateTime {
  const zoned = DateTime.fromJSDate(at).setZone(timezone ?? homeZone ?? FALLBACK_ZONE);
  return zoned.isValid ? zoned : DateTime.fromJSDate(at).setZone(FALLBACK_ZONE);
}
