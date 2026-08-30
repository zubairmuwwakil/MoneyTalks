// Shared definition of the QStash schedules, imported by both
// qstash-schedules.mjs (create/update) and qstash-check.mjs (drift check).
// Keeping one source means the checker can never disagree with the creator.

/**
 * Base URL the cron endpoints are POSTed to.
 *
 * Prefer CRON_BASE_URL over APP_URL. They look interchangeable but have opposite
 * stability requirements: APP_URL builds links inside user-facing emails, so it
 * follows the consumer brand, while this addresses infrastructure and wants a
 * hostname that never moves. Conflating them is why a rebrand silently broke the
 * crons on 2026-08-18 — the schedules kept POSTing at a host that had started
 * 301-ing, and QStash does not follow redirects on POST.
 *
 * Whatever you set must actually serve the app's /api/cron/* routes. An
 * unauthenticated POST should return 401/403, never 404 or 405 — a 405 means
 * you are pointed at a different app entirely.
 */
export function resolveBaseUrl(env = process.env) {
  const raw = env.CRON_BASE_URL?.trim() || env.APP_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

/** QStash's own default. Fine for a job that only touches our own database. */
const DEFAULT_TIMEOUT = "2m";

/**
 * For jobs that deliberately wait on a cold third-party service.
 *
 * Cut off at the default, such a job is killed mid-fan-out and retried from
 * scratch — repeatedly paying the cold start it was created to absorb.
 */
const COLD_START_TIMEOUT = "5m";

/** Normalize QStash's millisecond response and our human duration config. */
export function timeoutMilliseconds(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  if (/^\d+$/.test(raw)) return Number(raw);
  const match = raw.match(/^(\d+)(ms|s|m|h)$/);
  if (!match) return null;
  const multipliers = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 };
  return Number(match[1]) * multipliers[match[2]];
}

// ORDERING NOTE — prices-warmup MUST fire before prices, with real margin.
//
// MarketLens answers from a cache and only fans out to its upstream provider
// when the cache cannot answer. Whoever triggers the first fan-out of the night
// pays for it under a deadline; whoever loses that race is served a cached price
// that is indistinguishable from a fresh one. Through 2026-08 the loser was the
// price cron, every night, and the portfolio sat one session stale with no error
// anywhere. See docs/decisions/LOG.md 2026-08-27.
//
// The warm-up therefore does the fan-out first, and the gap must be long enough
// for a cold container boot plus a QStash retry to still land before 02:00.
// Asserted in qstash-schedules.config.test.ts, not just described here.
//
// scheduleIds are deliberately frozen at their original "moneytalks-" prefix.
// They are internal QStash identifiers, not branding: renaming one does not
// rename a schedule, it creates a second one and orphans the first.
export const schedules = [
  { name: "digest",         scheduleId: "moneytalks-digest",         path: "/api/cron/digest",         cronEnv: "QSTASH_DIGEST_CRON",         cronDefault: "*/15 * * * *" },
  { name: "notify",         scheduleId: "moneytalks-notify",         path: "/api/cron/notify",         cronEnv: "QSTASH_NOTIFY_CRON",         cronDefault: "0 * * * *" },
  { name: "purchase-merge", scheduleId: "moneytalks-purchase-merge", path: "/api/cron/purchase-merge", cronEnv: "QSTASH_PURCHASE_MERGE_CRON", cronDefault: "30 3 * * *" },
  { name: "recurring-sweep", scheduleId: "moneytalks-recurring-sweep", path: "/api/cron/recurring-sweep", cronEnv: "QSTASH_RECURRING_SWEEP_CRON", cronDefault: "45 3 * * *" },
  { name: "fx",             scheduleId: "moneytalks-fx",             path: "/api/cron/fx",             cronEnv: "QSTASH_FX_CRON",             cronDefault: "0 11 * * *" },
  { name: "prices-warmup",  scheduleId: "moneytalks-prices-warmup",  path: "/api/cron/prices-warmup",  cronEnv: "QSTASH_PRICES_WARMUP_CRON",  cronDefault: "45 1 * * *", timeout: COLD_START_TIMEOUT },
  { name: "prices",         scheduleId: "moneytalks-prices",         path: "/api/cron/prices",         cronEnv: "QSTASH_PRICES_CRON",         cronDefault: "0 2 * * *",  timeout: COLD_START_TIMEOUT },
  { name: "wallet-diagnostics", scheduleId: "moneytalks-wallet-diagnostics", path: "/api/cron/wallet-diagnostics", cronEnv: "QSTASH_WALLET_DIAGNOSTICS_CRON", cronDefault: "15 4 * * *" },
];

export function expected(env = process.env) {
  const base = resolveBaseUrl(env);
  return schedules.map((s) => ({
    ...s,
    cron: env[s.cronEnv] || s.cronDefault,
    timeout: s.timeout || DEFAULT_TIMEOUT,
    destination: base ? `${base}${s.path}` : null,
  }));
}
