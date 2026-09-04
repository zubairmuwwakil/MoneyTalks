import { describe, expect, it } from "vitest";
import { expected, schedules, timeoutMilliseconds } from "./qstash-schedules.config.mjs";

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
  it("compares QStash millisecond timeouts with human-readable config durations", () => {
    expect(timeoutMilliseconds("120000")).toBe(timeoutMilliseconds("2m"));
    expect(timeoutMilliseconds(300_000)).toBe(timeoutMilliseconds("5m"));
    expect(timeoutMilliseconds("90s")).toBe(90_000);
    expect(timeoutMilliseconds("not-a-duration")).toBeNull();
  });

  it("warms MarketLens strictly before the price cron reads it", () => {
    const warmup = bySlug("prices-warmup");
    const prices = bySlug("prices");
    expect(minutesUtc(warmup.cron)).toBeLessThan(minutesUtc(prices.cron));
  });

  it("leaves the warm-up enough lead time to absorb a cold start and a full fan-out", () => {
    const gap = minutesUtc(bySlug("prices").cron) - minutesUtc(bySlug("prices-warmup").cron);
    expect(gap).toBeGreaterThanOrEqual(10);
  });

  it("gives the two market-data jobs longer than the default QStash timeout", () => {
    expect(bySlug("prices-warmup").timeout).toBe("5m");
    expect(bySlug("prices").timeout).toBe("5m");
  });

  it("gives every schedule a timeout so none silently inherits a new default", () => {
    for (const schedule of all()) {
      expect(schedule.timeout, `${schedule.name} has no timeout`).toBeTruthy();
    }
  });

  /**
   * Start order, not completion order. Nothing here prevents a long purchase-merge
   * from still running when the sweep begins, and that is deliberate rather than
   * unhandled: the sweep is queue-driven (`RecurringSweepJob`) and re-derives each
   * owner's full history against `ALGORITHM_VERSION`, so a night that reads
   * not-yet-deduplicated purchases is corrected by the next run instead of
   * persisting a wrong obligation. Do not add a completion barrier to enforce a
   * dependency the design already converges on.
   */
  it("starts the recurring sweep after purchase duplicate identities settle", () => {
    expect(minutesUtc(bySlug("recurring-sweep").cron)).toBeGreaterThan(
      minutesUtc(bySlug("purchase-merge").cron),
    );
  });

  it("runs requested Gmail backfills in resumable five-minute increments", () => {
    const backfill = bySlug("gmail-backfill");
    expect(backfill.path).toBe("/api/cron/gmail-backfill");
    expect(backfill.cron).toBe("*/5 * * * *");
    expect(backfill.timeout).toBe("2m");
  });

  it("reprocesses email facts before the recurring obligation sweep", () => {
    const reprocess = bySlug("email-fact-reprocess");
    const recurring = bySlug("recurring-sweep");

    expect(reprocess.path).toBe("/api/cron/email-fact-reprocess");
    expect(reprocess.cron).toBe("0 3 * * *");
    expect(reprocess.timeout).toBe("2m");
    expect(minutesUtc(reprocess.cron)).toBeLessThan(minutesUtc(recurring.cron));
  });

  it("reconciles personal inventory frequently enough to repair missed webhooks", () => {
    const inventory = bySlug("personal-inventory");
    expect(inventory.path).toBe("/api/cron/personal-inventory");
    expect(inventory.cron).toBe("*/15 * * * *");
    expect(inventory.timeout).toBe("2m");
  });

  it("sweeps every retention domain in one nightly job, outside the submission path", () => {
    const sweep = bySlug("retention-sweep");
    expect(sweep.path).toBe("/api/cron/retention-sweep");
    expect(sweep.cron).toBe("15 4 * * *");
    expect(sweep.timeout).toBe("2m");
  });

  it("sweeps retention after the nightly writers that create the rows it expires", () => {
    for (const writer of ["purchase-merge", "recurring-sweep"]) {
      expect(
        minutesUtc(bySlug("retention-sweep").cron),
        `retention-sweep must run after ${writer}`,
      ).toBeGreaterThan(minutesUtc(bySlug(writer).cron));
    }
  });

  it("keeps scheduleIds frozen, because renaming one orphans the old schedule", () => {
    expect(Object.fromEntries((schedules as unknown as Schedule[]).map((s) => [s.name, s.scheduleId]))).toEqual({
      digest: "moneytalks-digest",
      notify: "moneytalks-notify",
      "purchase-merge": "moneytalks-purchase-merge",
      "email-fact-reprocess": "moneytalks-email-fact-reprocess",
      "recurring-sweep": "moneytalks-recurring-sweep",
      "gmail-backfill": "moneytalks-gmail-backfill",
      "personal-inventory": "moneytalks-personal-inventory",
      fx: "moneytalks-fx",
      "prices-warmup": "moneytalks-prices-warmup",
      prices: "moneytalks-prices",
      "retention-sweep": "moneytalks-wallet-diagnostics",
    });
  });
});
