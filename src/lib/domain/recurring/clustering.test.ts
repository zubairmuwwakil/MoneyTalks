import { describe, expect, it } from "vitest";
import {
  clusterRecurringPurchases,
  type ClusteringPurchase,
} from "./clustering";

const DAY_MS = 86_400_000;

function utcDate(iso: string, hour = 12): Date {
  return new Date(`${iso}T${hour.toString().padStart(2, "0")}:00:00.000Z`);
}

function daysFrom(start: Date, offset: number, hour = 12): Date {
  return new Date(start.getTime() + offset * DAY_MS + (hour - 12) * 3_600_000);
}

function purchase(
  id: string,
  date: Date,
  amountMinor: number,
  overrides: Partial<ClusteringPurchase> = {},
): ClusteringPurchase {
  return {
    id,
    userId: "user-1",
    canonicalMerchantId: "merchant-1",
    currency: "CAD",
    date,
    amountMinor,
    ...overrides,
  };
}

function amazonNoise(): ClusteringPurchase[] {
  const start = utcDate("2026-01-01");
  const burstOffsets = [0, 3, 19, 42, 68, 103, 149, 210, 287, 389];
  return burstOffsets.flatMap((offset, burst) => (
    [8, 11, 15, 19].map((hour, index) => purchase(
      `amazon-noise-${burst}-${index}`,
      daysFrom(start, offset, hour),
      1_700 + burst * 731 + index * 293,
      { canonicalMerchantId: "amazon" },
    ))
  ));
}

describe("clusterRecurringPurchases", () => {
  it("netflix-monthly-clean", () => {
    const purchases = [
      ["2026-01-15", 2_099],
      ["2026-02-14", 2_099],
      ["2026-03-16", 2_099],
      ["2026-04-15", 2_099],
      ["2026-05-15", 2_099],
      ["2026-06-14", 2_099],
    ].map(([date, amount], index) => purchase(
      `netflix-${index}`,
      utcDate(date as string),
      amount as number,
      { canonicalMerchantId: "netflix", currency: "USD" },
    ));

    const clusters = clusterRecurringPurchases(purchases, "America/Toronto");

    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      canonicalMerchantId: "netflix",
      currency: "USD",
      discriminator: null,
      cadence: { cadence: { type: "MONTHLY", dayOfMonth: 15 } },
      amountPattern: { pattern: "FIXED" },
    });
    expect(clusters[0].purchases).toHaveLength(6);
  });

  it("utility-variable-dates-regular", () => {
    const amounts = [8_200, 10_500, 9_400, 11_200, 8_900, 10_100];
    const dates = ["2026-01-05", "2026-02-04", "2026-03-06", "2026-04-05", "2026-05-06", "2026-06-05"];
    const purchases = dates.map((date, index) => purchase(
      `utility-${index}`,
      utcDate(date),
      amounts[index],
      { canonicalMerchantId: "toronto-hydro" },
    ));

    const clusters = clusterRecurringPurchases(purchases, "America/Toronto");

    expect(clusters).toHaveLength(1);
    expect(clusters[0].cadence.cadence.type).toBe("MONTHLY");
    expect(clusters[0].amountPattern.pattern).toBe("VARIABLE");
    expect(clusters[0].purchases.map(({ id }) => id)).toEqual(purchases.map(({ id }) => id));
  });

  it("two-obligations-one-merchant", () => {
    const monthly = ["2026-01-10", "2026-02-09", "2026-03-11", "2026-04-10", "2026-05-10", "2026-06-09"]
      .map((date, index) => purchase(`monthly-${index}`, utcDate(date), 1_500));
    const annual = ["2024-07-01", "2025-07-02", "2026-07-01"]
      .map((date, index) => purchase(`annual-${index}`, utcDate(date), 12_000));

    const clusters = clusterRecurringPurchases([...annual, ...monthly], "UTC");

    expect(clusters).toHaveLength(2);
    expect(clusters.map(({ cadence }) => cadence.cadence.type).sort()).toEqual(["ANNUAL", "MONTHLY"]);
    expect(clusters.map(({ purchases: evidence }) => evidence.map(({ id }) => id).sort())).toEqual([
      monthly.map(({ id }) => id),
      annual.map(({ id }) => id),
    ]);
  });

  it("currency-split", () => {
    const dates = ["2026-01-15", "2026-02-14", "2026-03-16", "2026-04-15"];
    const cad = dates.map((date, index) => purchase(`cad-${index}`, utcDate(date), 1_499));
    const usd = dates.map((date, index) => purchase(
      `usd-${index}`,
      utcDate(date),
      1_099,
      { currency: "USD" },
    ));

    const clusters = clusterRecurringPurchases([...cad, ...usd], "UTC");

    expect(clusters).toHaveLength(2);
    expect(clusters.map(({ currency }) => currency).sort()).toEqual(["CAD", "USD"]);
    expect(clusters.every(({ purchases: evidence }) => (
      new Set(evidence.map(({ currency }) => currency)).size === 1
    ))).toBe(true);
  });

  it("discriminator-split", () => {
    const dates = ["2026-01-08", "2026-02-07", "2026-03-09"];
    const accountA = dates.map((date, index) => purchase(
      `aws-a-${index}`,
      utcDate(date),
      3_000 + index * 500,
      { canonicalMerchantId: "aws", discriminator: "account ••1234" },
    ));
    const accountB = dates.map((date, index) => purchase(
      `aws-b-${index}`,
      utcDate(date),
      8_000 + index * 1_000,
      { canonicalMerchantId: "aws", discriminator: "account ••9876" },
    ));

    const clusters = clusterRecurringPurchases([...accountA, ...accountB], "UTC");

    expect(clusters).toHaveLength(2);
    expect(clusters.map(({ discriminator }) => discriminator).sort()).toEqual([
      "account ••1234",
      "account ••9876",
    ]);
  });

  it("amazon-noise", () => {
    expect(clusterRecurringPurchases(amazonNoise(), "UTC")).toEqual([]);
  });

  it("amazon-prime-buried-in-noise", () => {
    const prime = [
      "2026-01-15", "2026-02-14", "2026-03-16", "2026-04-15",
      "2026-05-15", "2026-06-14", "2026-07-14", "2026-08-13",
      "2026-09-12", "2026-10-12", "2026-11-11", "2026-12-11",
    ].map((date, index) => purchase(
      `prime-${index}`,
      utcDate(date),
      1_099,
      { canonicalMerchantId: "amazon" },
    ));
    const noise = amazonNoise();

    const clusters = clusterRecurringPurchases([...noise, ...prime], "UTC");

    expect(clusters).toHaveLength(1);
    expect(clusters[0].cadence.cadence.type).toBe("MONTHLY");
    expect(clusters[0].purchases.map(({ id }) => id)).toEqual(prime.map(({ id }) => id));
    const clusteredIds = new Set(clusters.flatMap(({ purchases: evidence }) => evidence.map(({ id }) => id)));
    expect(noise.every(({ id }) => !clusteredIds.has(id))).toBe(true);
  });

  it("single-occurrence", () => {
    expect(clusterRecurringPurchases([
      purchase("only", utcDate("2026-01-15"), 2_099),
    ], "UTC")).toEqual([]);
  });
});

describe("unpriced observations", () => {
  it("clusters a series whose receipts never state a price", () => {
    // Cloudflare's "Your invoice is available" — dated, never priced. The
    // cadence is real and must be detectable; only the amount is unknown.
    const monthly = [0, 1, 2, 3, 4].map((n) => ({
      id: `cf-${n}`,
      userId: "user-1",
      canonicalMerchantId: "cloudflare.com",
      date: new Date(Date.UTC(2026, 2 + n, 11)),
      amountMinor: null,
      currency: "CAD",
    }));

    const clusters = clusterRecurringPurchases(monthly);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].cadence.cadence.type).toBe("MONTHLY");
    expect(clusters[0].amountPattern.pattern).toBe("UNKNOWN");
    expect(clusters[0].amountPattern.schedule).toEqual([]);
  });

  it("still rejects a non-integer amount", () => {
    expect(() =>
      clusterRecurringPurchases([
        { id: "a", userId: "u", canonicalMerchantId: "m", date: new Date(), amountMinor: 1.5, currency: "CAD" },
      ]),
    ).toThrow(RangeError);
  });
});
