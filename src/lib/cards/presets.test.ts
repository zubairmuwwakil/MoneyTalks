import { describe, it, expect } from "vitest";
import { CARD_PRESETS } from "./presets";
import { cardImportEntry } from "../validation/cards";

function optional(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function toPayload(values: (typeof CARD_PRESETS)[0]["values"]) {
  return {
    nickname: values.nickname,
    issuer: values.issuer,
    network: values.network,
    lastFour: optional(values.lastFour),
    country: values.country,
    currency: values.currency,
    limit: optional(values.limit),
    statementDay: optional(values.statementDay),
    dueDay: optional(values.dueDay),
    aprPct: optional(values.aprPct),
    annualFee: values.annualFee,
    feeMonthDay: optional(values.feeMonthDay),
    feeCancelGraceDays: optional(values.feeCancelGraceDays),
    rewards: {
      pointValueCents: values.rewards.pointValueCents,
      fxFeePct: values.rewards.fxFeePct,
      baseMultiplier: values.rewards.baseMultiplier,
      categoryRates: values.rewards.categoryRates.map(({ cap, capWindow, capGroupId, requiresConditionId, ...rate }) => {
        const spendCap = optional(cap);
        return {
          ...rate,
          capGroupId: optional(capGroupId),
          requiresConditionId: optional(requiresConditionId),
          ...(spendCap === undefined ? {} : { cap: spendCap, capWindow }),
        };
      }),
      credits: values.rewards.credits,
      capGroups: values.rewards.capGroups,
      conditions: values.rewards.conditions.map(({ annualFeeReduction, ...condition }) => ({
        ...condition,
        annualFeeReduction: optional(annualFeeReduction),
      })),
      merchantRates: values.rewards.merchantRates.map(({ requiresConditionId, ...rate }) => ({
        ...rate,
        requiresConditionId: optional(requiresConditionId),
      })),
      baseRateOverrides: values.rewards.baseRateOverrides.map(({ cap, capWindow, ...rate }) => {
        const spendCap = optional(cap);
        return { ...rate, ...(spendCap === undefined ? {} : { cap: spendCap, capWindow }) };
      }),
    },
  };
}

describe("CARD_PRESETS", () => {
  it("has presets available", () => {
    expect(CARD_PRESETS.length).toBeGreaterThanOrEqual(10);
  });

  CARD_PRESETS.forEach((preset) => {
    it(`validates preset: ${preset.name} (${preset.id})`, () => {
      const payload = toPayload(preset.values);
      const parsed = cardImportEntry.safeParse(payload);
      if (!parsed.success) {
        console.error(`Validation failed for preset ${preset.id}:`, parsed.error.issues);
      }
      expect(parsed.success).toBe(true);
    });
  });
});
