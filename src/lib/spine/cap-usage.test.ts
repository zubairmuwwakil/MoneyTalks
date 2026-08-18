import { describe, expect, it } from "vitest";
import type { FxRateInput } from "@/engine/fx";
import { applyCapAccrual, capPeriodKey, removeCapAccrual, resolveCapAccrual, resolveCapAccrualOutcome, reverseCapAccrual } from "./cap-usage";

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
      delete: async (args: unknown) => {
        const id = (args as { where: { id: string } }).where.id;
        for (const [sourceKey, accrual] of accruals) if (accrual.id === id) accruals.delete(sourceKey);
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

  it("merges matching CAD rules into their shared cap", () => {
    const state = ownerState({ "rogers-red-we": { rogersEligibleServiceLinked: true, rogersAccountAnniversaryMonth: 8 } });
    const cad = resolveCapAccrual(source({ sourceKey: "wallet:cad", cardId: "rogers-red-we", category: "unknown", currency: "CAD" }), state);
    expect(cad?.capId).toBe("rogers-enhanced-accountYear");
    expect(cad?.periodKey).toBe("2026-08");
  });

  it("does not accrue an amount whose CAD value is unknown", () => {
    const state = ownerState({ "amex-cobalt": {} });
    expect(resolveCapAccrual(source({ currency: null }), state)).toBeNull();
    expect(resolveCapAccrual(source({ currency: "USD" }), state)).toBeNull();
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

  it("removes a stale projection accrual so explicit evidence can accrue again", async () => {
    const memory = memoryLedger();
    const state = ownerState({ "amex-cobalt": {} });
    const key = memory.ledgerKey({ userId: "user-1", cardId: "amex-cobalt", capId: "cobalt-eats-monthly", periodKey: "2026-08" });

    await applyCapAccrual(memory.tx as never, source(), state);
    expect(await removeCapAccrual(memory.tx as never, "wallet:event-1")).toBe(true);
    expect(memory.totals.get(key)).toBe(0);

    await applyCapAccrual(memory.tx as never, source(), state);
    expect(memory.totals.get(key)).toBe(12_345);
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

describe("foreign-currency accrual", () => {
  const rates: FxRateInput[] = [{ base: "USD", quote: "CAD", rate: 1.37, asOf: "2026-08-10T00:00:00.000Z" }];

  it("converts a USD purchase into the CAD ledger", () => {
    // Dropping non-CAD spend under-counts the ledger, so the engine can
    // recommend a card whose cap is nearer exhaustion than we believe.
    const accrual = resolveCapAccrual(
      source({ currency: "USD", amountMinor: 10_000 }),
      ownerState({ "amex-cobalt": {} }),
      undefined,
      rates,
    );

    expect(accrual?.usedMinor).toBe(13_700);
  });

  it("records the rate it used, so an accrual can be audited later", () => {
    const accrual = resolveCapAccrual(
      source({ currency: "USD", amountMinor: 10_000 }),
      ownerState({ "amex-cobalt": {} }),
      undefined,
      rates,
    );

    expect(accrual).toMatchObject({
      sourceAmountMinor: 10_000,
      sourceCurrency: "USD",
      fxRate: 1.37,
    });
    expect(accrual?.fxRateAsOf).toEqual(new Date("2026-08-10T00:00:00.000Z"));
  });

  it("leaves a native CAD accrual unconverted and unstamped", () => {
    const accrual = resolveCapAccrual(source(), ownerState({ "amex-cobalt": {} }), undefined, rates);

    expect(accrual).toMatchObject({ usedMinor: 12_345, sourceCurrency: "CAD", fxRate: null });
    expect(accrual?.fxRateAsOf).toBeNull();
  });

  it("refuses to accrue a foreign purchase with no rate on file", () => {
    // Fail closed: an unconverted foreign amount must never enter a CAD ledger.
    expect(resolveCapAccrual(source({ currency: "EUR" }), ownerState({ "amex-cobalt": {} }), undefined, rates)).toBeNull();
  });

  it("still refuses an unknown currency even when rates exist", () => {
    expect(resolveCapAccrual(source({ currency: null }), ownerState({ "amex-cobalt": {} }), undefined, rates)).toBeNull();
  });

  it("names why an accrual was skipped instead of failing silently", () => {
    const state = ownerState({ "amex-cobalt": {} });

    expect(resolveCapAccrualOutcome(source({ currency: null }), state, undefined, rates)).toMatchObject({ skipped: "unknown-currency" });
    expect(resolveCapAccrualOutcome(source({ currency: "EUR" }), state, undefined, rates)).toMatchObject({ skipped: "missing-fx-rate" });
    expect(resolveCapAccrualOutcome(source(), state, undefined, rates)).toMatchObject({ accrual: { usedMinor: 12_345 } });
  });

  it("uses an inverse rate when only CAD->USD is on file", () => {
    const inverse: FxRateInput[] = [{ base: "CAD", quote: "USD", rate: 0.73, asOf: "2026-08-10T00:00:00.000Z" }];
    const accrual = resolveCapAccrual(
      source({ currency: "USD", amountMinor: 7_300 }),
      ownerState({ "amex-cobalt": {} }),
      undefined,
      inverse,
    );

    expect(accrual?.usedMinor).toBe(10_000);
  });
});
