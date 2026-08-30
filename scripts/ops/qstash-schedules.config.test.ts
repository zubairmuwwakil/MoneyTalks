import { describe, expect, it } from "vitest";
import { expected, schedules } from "./qstash-schedules.config.mjs";

type Schedule = {
  name: string;
  scheduleId: string;
  path: string;
  cron: string;
  timeout: string;
  destination: string | null;
};

const env = { CRON_BASE_URL: "https://inunity.ca" } as unknown as NodeJS.ProcessEnv;
const all = (): Schedule[] => expected(env) as unknown as Schedule[];
const bySlug = (name: string): Schedule => all().find((s) => s.name === name)!;

const minutesUtc = (cron: string) => {
  const [minute, hour] = cron.split(" ");
  return Number(hour) * 60 + Number(minute);
};

/**
 * These schedules are the only reason any of this runs. Nothing in the app
 * verifies them at runtime, and the failure mode is silence — so the ordering
 * that makes the nightly valuation correct is asserted here instead of living
 * only in a comment somebody will eventually contradict.
 */
describe("QStash schedule contract", () => {
  it("warms MarketLens strictly before the price cron reads it", () => {
    // The warm sweep is what makes the read cheap and correct. Scheduled after
    // the read, it warms a cache nobody is going to look at until tomorrow.
    const warmup = bySlug("prices-warmup");
    const prices = bySlug("prices");

    expect(minutesUtc(warmup.cron)).toBeLessThan(minutesUtc(prices.cron));
  });

  it("leaves the warm-up enough lead time to absorb a cold start and a full fan-out", () => {
    const gap = minutesUtc(bySlug("prices").cron) - minutesUtc(bySlug("prices-warmup").cron);

    // A cold container boot plus a provider fan-out is minutes, not seconds. Five
    // was not enough margin to also allow a QStash retry to land in time.
    expect(gap).toBeGreaterThanOrEqual(10);
  });

  it("gives the two market-data jobs longer than the default QStash timeout", () => {
    // Both deliberately wait on a cold start. Cut off at the default, they are
    // retried from scratch rather than allowed to finish the work they started.
    expect(bySlug("prices-warmup").timeout).toBe("5m");
    expect(bySlug("prices").timeout).toBe("5m");
  });

  it("gives every schedule a timeout so none silently inherits a new default", () => {
    for (const schedule of all()) {
      expect(schedule.timeout, `${schedule.name} has no timeout`).toBeTruthy();
    }
  });

  it("sweeps recurring obligations after purchase duplicate identities settle", () => {
    expect(minutesUtc(bySlug("recurring-sweep").cron)).toBeGreaterThan(
      minutesUtc(bySlug("purchase-merge").cron),
    );
  });

  it("keeps scheduleIds frozen, because renaming one orphans the old schedule", () => {
    // QStash keys on scheduleId. A rename does not rename anything: it creates a
    // second schedule and leaves the first firing forever.
    expect(Object.fromEntries((schedules as unknown as Schedule[]).map((s) => [s.name, s.scheduleId]))).toEqual({
      digest: "moneytalks-digest",
      notify: "moneytalks-notify",
      "purchase-merge": "moneytalks-purchase-merge",
      "recurring-sweep": "moneytalks-recurring-sweep",
      fx: "moneytalks-fx",
      "prices-warmup": "moneytalks-prices-warmup",
      prices: "moneytalks-prices",
      "wallet-diagnostics": "moneytalks-wallet-diagnostics",
    });
  });
});
