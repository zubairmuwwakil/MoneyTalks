import { describe, expect, it } from "vitest";

import { syncFxRates } from "./fxSync";

const rates = [
  { base: "USD", quote: "CAD" as const, rate: 1.3712, asOf: "2026-08-15" },
  { base: "EUR", quote: "CAD" as const, rate: 1.4903, asOf: "2026-08-15" },
];

function fakeDb(userIds: string[]) {
  const rows = new Map<string, { userId: string; base: string; quote: string; rate: number; asOf: Date }>();
  const key = (r: { userId: string; base: string; quote: string; asOf: Date }) =>
    `${r.userId}|${r.base}|${r.quote}|${r.asOf.toISOString()}`;

  return {
    rows,
    user: { findMany: async () => userIds.map((id) => ({ id })) },
    fxRate: {
      upsert: async (args: {
        where: { userId_base_quote_asOf: { userId: string; base: string; quote: string; asOf: Date } };
        create: { userId: string; base: string; quote: string; rate: number; asOf: Date };
        update: { rate: number };
      }) => {
        const k = key(args.where.userId_base_quote_asOf);
        const existing = rows.get(k);
        if (existing) existing.rate = args.update.rate;
        else rows.set(k, args.create);
      },
    },
  };
}

describe("fx rate sync", () => {
  it("stores every rate for every user", async () => {
    // FxRate is deliberately per-user (users may hold manual rates), so a
    // market rate is written once per user rather than shared.
    const db = fakeDb(["user-1", "user-2"]);

    expect(await syncFxRates(db, rates)).toBe(4);
    expect(db.rows.size).toBe(4);
  });

  it("is idempotent across runs on the same day", async () => {
    const db = fakeDb(["user-1"]);

    await syncFxRates(db, rates);
    await syncFxRates(db, rates);

    expect(db.rows.size).toBe(2);
  });

  it("updates a corrected rate for the same asOf rather than duplicating", async () => {
    const db = fakeDb(["user-1"]);

    await syncFxRates(db, [rates[0]]);
    await syncFxRates(db, [{ ...rates[0], rate: 1.4 }]);

    expect(db.rows.size).toBe(1);
    expect([...db.rows.values()][0].rate).toBe(1.4);
  });

  it("writes nothing when the source returned no rates", async () => {
    const db = fakeDb(["user-1"]);

    expect(await syncFxRates(db, [])).toBe(0);
    expect(db.rows.size).toBe(0);
  });

  it("writes nothing when there are no users", async () => {
    const db = fakeDb([]);

    expect(await syncFxRates(db, rates)).toBe(0);
  });
});
