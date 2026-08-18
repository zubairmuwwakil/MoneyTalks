// Persist market FX rates for every user.
//
// FxRate is deliberately per-user — a user may hold a manually entered rate
// alongside the market one — so a daily market rate is written once per user
// rather than shared. The unique key is (userId, base, quote, asOf), which
// makes a re-run on the same day an update, never a duplicate.

import type { CadRate } from "@/lib/fetch-fx";

type FxSyncDb = {
  user: { findMany(args?: unknown): Promise<{ id: string }[]> };
  fxRate: {
    upsert(args: {
      where: { userId_base_quote_asOf: { userId: string; base: string; quote: string; asOf: Date } };
      create: { userId: string; base: string; quote: string; rate: number; asOf: Date };
      update: { rate: number };
    }): Promise<unknown>;
  };
};

/** Returns the number of rate rows written. */
export async function syncFxRates(db: FxSyncDb, rates: readonly CadRate[]): Promise<number> {
  if (rates.length === 0) return 0;

  const users = await db.user.findMany({ select: { id: true } });
  if (users.length === 0) return 0;

  let written = 0;
  for (const user of users) {
    for (const rate of rates) {
      const asOf = new Date(`${rate.asOf}T00:00:00.000Z`);
      await db.fxRate.upsert({
        where: {
          userId_base_quote_asOf: { userId: user.id, base: rate.base, quote: rate.quote, asOf },
        },
        create: { userId: user.id, base: rate.base, quote: rate.quote, rate: rate.rate, asOf },
        update: { rate: rate.rate },
      });
      written++;
    }
  }

  return written;
}
