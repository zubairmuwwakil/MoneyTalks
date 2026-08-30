// Sender address -> merchant key. Deliberately NOT marked `server-only`.
//
// This is a pure string function, and it is the identity function that
// receipt clustering keys on: two senders that fold to the same key are
// treated as the same merchant, and two that do not are treated as
// different. That makes it the one piece of the receipt pipeline an
// operational script must be able to replay outside Next — a reporter that
// reimplemented it could disagree with production, which is precisely the
// failure it would be trying to detect. `gmailPurchaseParser` keeps the
// `server-only` marker; this does not.

import { getDomain } from "tldts";

export function domainFromEmail(addr?: string | null): string | undefined {
  if (!addr) return undefined;
  const m = addr.match(/@([^>\s]+)/);
  return m?.[1]?.toLowerCase();
}

/**
 * The registrable domain for a sender, or a subject-derived fallback.
 *
 * Registrable domain, not a two-label slice: `parts.slice(-2)` maps every
 * `.co.uk` sender to `"co.uk"`, fusing unrelated companies into one merchant.
 * A false merge is worse than a miss — it yields a confident wrong answer
 * carrying the evidence of every merchant it swallowed.
 */
export function normalizeMerchantFromSender(fromEmail?: string | null, subject?: string | null): string {
  const domain = domainFromEmail(fromEmail);
  if (!domain) return subject?.split(" ")[0]?.toLowerCase() ?? "unknown";

  // tldts is larger than psl, but this path only runs server-side where client
  // bundle size is irrelevant. It embeds a current PSL snapshot (no runtime
  // fetch) and is actively maintained. Private suffixes are enabled because
  // collapsing two tenants of a hosted domain is the same false-merge class as
  // collapsing two .co.uk merchants.
  return getDomain(domain, { allowPrivateDomains: true }) ?? domain;
}

/**
 * True when a stored merchant key is a bare public suffix — `"co.uk"`,
 * `"com.au"`. These cannot be produced by `normalizeMerchantFromSender` and
 * are the fingerprint of the retired two-label slice. Each such row is an
 * aggregate of every sender under that suffix.
 */
export function isPublicSuffixKey(key: string): boolean {
  const trimmed = key.trim().toLowerCase();
  if (!trimmed.includes(".") || /\s/.test(trimmed)) return false;
  return getDomain(trimmed, { allowPrivateDomains: true }) === null;
}
