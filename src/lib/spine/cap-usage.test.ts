import { describe, expect, it } from "vitest";
import { applyCapAccrual, capPeriodKey, resolveCapAccrual, reverseCapAccrual } from "./cap-usage";

const ownerState = (cardStates: Record<string, unknown>) => ({ cardStates });

const source = (overrides: Partial<Parameters<typeof resolveCapAccrual>[0]> = {}) => ({
  sourceKey: "wallet:event-1",
  userId: "user-1",
  cardId: "amex-cobalt",
  category: "dining",
  merchantBrand: "coffee-shop",
  amountMinor: 12_345,
  currency: "CAD",
  occurredAt: new Date("2026-08-16T16:00:00.000Z"),
  ...overrides,
});

type Accrual = { id: string; userId: string; sourceKey: string; cardId: string; capId: string; periodKey: string; usedMinor: number; reversedAt: Date | null };

function memoryLedger() {
  const accruals = new Map<string, Accrual>();
  const totals = new Map<string, number>();
  const ledgerKey = (input: { userId: string; cardId: string; capId: string; periodKey: string }) => `${input.userId}:${input.cardId}:${input.capId}:${input.periodKey}`;
  const tx = {
    capAccrual: {
      findUnique: async (args: unknown) => accruals.get((args as { where: { sourceKey: string } }).where.sourceKey) ?? null,
      create: async (args: unknown) => {
        const data = (args as { data: Omit<Accrual, "id" | "reversedAt"> }).data;
        accruals.set(data.sourceKey, { ...data, id: `accrual-${accruals.size + 1}`, reversedAt: null });
      },
      update: async (args: unknown) => {
        const { where, data } = args as { where: { id: string }; data: { reversedAt: Date } };
        for (const accrual of accruals.values()) if (accrual.id === where.id) accrual.reversedAt = data.reversedAt;
      },
    },
    capUsageLedger: {
      upsert: async (args: unknown) => {
        const { where, create, update } = args as {
          where: { userId_cardId_capId_periodKey: { userId: string; cardId: string; capId: string; periodKey: string } };
          create: { usedMinor: number };
          update: { usedMinor: { increment: number } };
        };
        const key = ledgerKey(where.userId_cardId_capId_periodKey);
        totals.set(key, (totals.get(key) ?? create.usedMinor) + (totals.has(key) ? update.usedMinor.increment : 0));
      },
      update: async (args: unknown) => {
        const { where, data } = args as {
          where: { userId_cardId_capId_periodKey: { userId: string; cardId: string; capId: string; periodKey: string } };
          data: { usedMinor: { decrement: number } };
        };
        const key = ledgerKey(where.userId_cardId_capId_periodKey);
        totals.set(key, (totals.get(key) ?? 0) - data.usedMinor.decrement);
      },
    },
  };
  return { tx, accruals, totals, ledgerKey };
}

describe("cap usage", () => {
  it("accrues a calendar-month cap in Toronto", () => {
    const accrual = resolveCapAccrual(source(), ownerState({ "amex-cobalt": {} }));
    expect(accrual).toMatchObject({ capId: "cobalt-eats-monthly", periodKey: "2026-08", usedMinor: 12_345 });
  });

  it("rolls account-year windows at the declared anchor month", () => {
    const state = { scotiaAccountYearAnchorMonth: 4 };
    expect(capPeriodKey({ period: "accountYear", anchor: "ownerState.scotiaAccountYearAnchorMonth" }, state, new Date("2026-03-31T16:00:00.000Z"))).toBe("2025-04");
    expect(capPeriodKey({ period: "accountYear", anchor: "ownerState.scotiaAccountYearAnchorMonth" }, state, new Date("2026-04-01T16:00:00.000Z"))).toBe("2026-04");
  });

  it("merges multiple matching rules into their shared cap", () => {
    const state = ownerState({ "rogers-red-we": { rogersEligibleServiceLinked: true, rogersAccountAnniversaryMonth: 8 } });
    const cad = resolveCapAccrual(source({ sourceKey: "wallet:cad", cardId: "rogers-red-we", category: "unknown", currency: "CAD" }), state);
    const usd = resolveCapAccrual(source({ sourceKey: "wallet:usd", cardId: "rogers-red-we", category: "unknown", currency: "USD" }), state);
    expect(cad?.capId).toBe("rogers-enhanced-accountYear");
    expect(usd?.capId).toBe("rogers-enhanced-accountYear");
    expect(cad?.periodKey).toBe("2026-08");
  });

  it("is idempotent and decrements only once when a WalletEvent reverses", async () => {
    const memory = memoryLedger();
    const state = ownerState({ "amex-cobalt": {} });
    await applyCapAccrual(memory.tx as never, source(), state);
    await applyCapAccrual(memory.tx as never, source(), state);
    const key = memory.ledgerKey({ userId: "user-1", cardId: "amex-cobalt", capId: "cobalt-eats-monthly", periodKey: "2026-08" });
    expect(memory.totals.get(key)).toBe(12_345);

    await reverseCapAccrual(memory.tx as never, "wallet:event-1");
    await reverseCapAccrual(memory.tx as never, "wallet:event-1");
    expect(memory.totals.get(key)).toBe(0);
  });

  it("converts a USD-measured cap using the twin's 0.73 fallback", () => {
    const accrual = resolveCapAccrual(source({
      cardId: "cryptocom-royal-indigo",
      category: "unknown",
      amountMinor: 200_000,
    }), ownerState({ "cryptocom-royal-indigo": { cryptoLevelUpProActive: true } }));
    expect(accrual).toMatchObject({ capId: "crypto-monthly-usd", usedMinor: 146_000 });
  });
});
