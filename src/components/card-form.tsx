"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createCard, type CardFormState, updateCard } from "@/app/cards/actions";
import { CATEGORY_LABELS, SPEND_CATEGORIES, type Network, type SpendCategory } from "@/engine/cards/types";

type CategoryRateForm = {
  category: SpendCategory;
  multiplier: string;
  cap: string;
  capWindow: "MONTH" | "YEAR";
  capGroupId: string;
  requiresConditionId: string;
};

type CreditForm = {
  id: string;
  label: string;
  value: string;
  period: "YEAR" | "MONTH";
};

type CapGroupForm = {
  id: string;
  label: string;
  cap: string;
  capWindow: "MONTH" | "YEAR";
};

type ConditionForm = {
  id: string;
  label: string;
  enabled: boolean;
  annualFeeReduction: string;
};

type MerchantRateForm = {
  id: string;
  merchant: string;
  multiplier: string;
  requiresConditionId: string;
};

type BaseRateOverrideForm = {
  id: string;
  label: string;
  multiplier: string;
  requiresConditionId: string;
  cap: string;
  capWindow: "MONTH" | "YEAR";
};

export type CardFormValues = {
  nickname: string;
  issuer: string;
  network: Network;
  lastFour: string;
  country: string;
  currency: "CAD" | "USD" | "JMD";
  limit: string;
  statementDay: string;
  dueDay: string;
  aprPct: string;
  annualFee: string;
  rewards: {
    pointValueCents: string;
    fxFeePct: string;
    baseMultiplier: string;
    categoryRates: CategoryRateForm[];
    credits: CreditForm[];
    capGroups: CapGroupForm[];
    conditions: ConditionForm[];
    merchantRates: MerchantRateForm[];
    baseRateOverrides: BaseRateOverrideForm[];
  };
};

const input = "mt-1 w-full rounded border px-3 py-2 text-sm";
const label = "block text-sm";
const initialCardFormState: CardFormState = {};

const emptyCard: CardFormValues = {
  nickname: "",
  issuer: "",
  network: "VISA",
  lastFour: "",
  country: "CA",
  currency: "CAD",
  limit: "",
  statementDay: "",
  dueDay: "",
  aprPct: "",
  annualFee: "0.00",
  rewards: {
    pointValueCents: "1",
    fxFeePct: "0",
    baseMultiplier: "1",
    categoryRates: [],
    credits: [],
    capGroups: [],
    conditions: [],
    merchantRates: [],
    baseRateOverrides: [],
  },
};

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function toPayload(values: CardFormValues) {
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

function fieldError(state: CardFormState, path: string) {
  return state.fieldErrors?.[path];
}

function ErrorText({ error, id }: { error?: string; id?: string }) {
  return error ? <p id={id} className="mt-1 text-xs text-red-600">{error}</p> : null;
}

function newCreditId(credits: CreditForm[]): string {
  let number = 1;
  while (credits.some((credit) => credit.id === `credit-${number}`)) number += 1;
  return `credit-${number}`;
}

function newId(prefix: string, values: { id: string }[]): string {
  let number = 1;
  while (values.some((value) => value.id === `${prefix}-${number}`)) number += 1;
  return `${prefix}-${number}`;
}

export function CardForm({
  mode,
  cardId,
  initialValues = emptyCard,
}: {
  mode: "create" | "edit";
  cardId?: string;
  initialValues?: CardFormValues;
}) {
  const [values, setValues] = useState<CardFormValues>(initialValues);
  const action = mode === "create" ? createCard : updateCard;
  const [state, formAction, isPending] = useActionState(action, initialCardFormState);
  const availableCategories = SPEND_CATEGORIES.filter(
    (category) => !values.rewards.categoryRates.some((rate) => rate.category === category),
  );
  const returnHref = mode === "edit" && cardId ? `/cards/${cardId}` : "/cards/manage";

  function updateCategory(index: number, update: Partial<CategoryRateForm>) {
    setValues((current) => ({
      ...current,
      rewards: {
        ...current.rewards,
        categoryRates: current.rewards.categoryRates.map((rate, rateIndex) =>
          rateIndex === index ? { ...rate, ...update } : rate,
        ),
      },
    }));
  }

  function updateCredit(index: number, update: Partial<CreditForm>) {
    setValues((current) => ({
      ...current,
      rewards: {
        ...current.rewards,
        credits: current.rewards.credits.map((credit, creditIndex) =>
          creditIndex === index ? { ...credit, ...update } : credit,
        ),
      },
    }));
  }

  function updateCapGroup(index: number, update: Partial<CapGroupForm>) {
    setValues((current) => ({
      ...current,
      rewards: {
        ...current.rewards,
        capGroups: current.rewards.capGroups.map((group, groupIndex) =>
          groupIndex === index ? { ...group, ...update } : group,
        ),
      },
    }));
  }

  function updateCondition(index: number, update: Partial<ConditionForm>) {
    setValues((current) => ({
      ...current,
      rewards: {
        ...current.rewards,
        conditions: current.rewards.conditions.map((condition, conditionIndex) =>
          conditionIndex === index ? { ...condition, ...update } : condition,
        ),
      },
    }));
  }

  function updateMerchantRate(index: number, update: Partial<MerchantRateForm>) {
    setValues((current) => ({
      ...current,
      rewards: {
        ...current.rewards,
        merchantRates: current.rewards.merchantRates.map((rate, rateIndex) =>
          rateIndex === index ? { ...rate, ...update } : rate,
        ),
      },
    }));
  }

  function updateBaseRateOverride(index: number, update: Partial<BaseRateOverrideForm>) {
    setValues((current) => ({
      ...current,
      rewards: {
        ...current.rewards,
        baseRateOverrides: current.rewards.baseRateOverrides.map((rate, rateIndex) =>
          rateIndex === index ? { ...rate, ...update } : rate,
        ),
      },
    }));
  }

  return (
    <form action={formAction} className="space-y-8">
      <input type="hidden" name="cardJson" value={JSON.stringify(toPayload(values))} />
      {mode === "edit" ? <input type="hidden" name="cardId" value={cardId} /> : null}

      {state.error && !state.fieldErrors?.nickname ? <p role="alert" className="text-sm text-red-600">{state.error}</p> : null}

      <section className="space-y-4">
        <div>
          <h2 className="font-medium">Card details</h2>
          <p className="mt-1 text-sm text-muted-foreground">Use a nickname you will recognize at a glance.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>
            Nickname
            <input
              name="nickname"
              required
              value={values.nickname}
              onChange={(event) => setValues((current) => ({ ...current, nickname: event.target.value }))}
              aria-describedby={fieldError(state, "nickname") ? "nickname-error" : undefined}
              className={input}
            />
            <ErrorText id="nickname-error" error={fieldError(state, "nickname")} />
          </label>
          <label className={label}>
            Issuer
            <input
              name="issuer"
              required
              value={values.issuer}
              onChange={(event) => setValues((current) => ({ ...current, issuer: event.target.value }))}
              className={input}
            />
            <ErrorText error={fieldError(state, "issuer")} />
          </label>
          <label className={label}>
            Network
            <select
              name="network"
              value={values.network}
              onChange={(event) => setValues((current) => ({ ...current, network: event.target.value as Network }))}
              className={input}
            >
              <option value="VISA">Visa</option>
              <option value="MASTERCARD">Mastercard</option>
              <option value="AMEX">American Express</option>
            </select>
          </label>
          <label className={label}>
            Annual fee ($)
            <input
              name="annualFee"
              type="number"
              min="0"
              step="0.01"
              required
              value={values.annualFee}
              onChange={(event) => setValues((current) => ({ ...current, annualFee: event.target.value }))}
              className={input}
            />
            <ErrorText error={fieldError(state, "annualFee")} />
          </label>
        </div>

        <details className="rounded border p-4">
          <summary className="cursor-pointer text-sm font-medium">Optional account details</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className={label}>
              Last four digits
              <input
                name="lastFour"
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                value={values.lastFour}
                onChange={(event) => setValues((current) => ({ ...current, lastFour: event.target.value }))}
                className={input}
              />
              <ErrorText error={fieldError(state, "lastFour")} />
            </label>
            <label className={label}>
              Credit limit ($)
              <input
                name="limit"
                type="number"
                min="0.01"
                step="0.01"
                value={values.limit}
                onChange={(event) => setValues((current) => ({ ...current, limit: event.target.value }))}
                className={input}
              />
              <ErrorText error={fieldError(state, "limit")} />
            </label>
            <label className={label}>
              Statement day
              <input
                name="statementDay"
                type="number"
                min="1"
                max="28"
                value={values.statementDay}
                onChange={(event) => setValues((current) => ({ ...current, statementDay: event.target.value }))}
                className={input}
              />
              <ErrorText error={fieldError(state, "statementDay")} />
            </label>
            <label className={label}>
              Due day
              <input
                name="dueDay"
                type="number"
                min="1"
                max="28"
                value={values.dueDay}
                onChange={(event) => setValues((current) => ({ ...current, dueDay: event.target.value }))}
                className={input}
              />
              <ErrorText error={fieldError(state, "dueDay")} />
            </label>
            <label className={label}>
              Purchase APR (%)
              <input
                name="aprPct"
                type="number"
                min="0"
                max="50"
                step="0.01"
                value={values.aprPct}
                onChange={(event) => setValues((current) => ({ ...current, aprPct: event.target.value }))}
                className={input}
              />
              <ErrorText error={fieldError(state, "aprPct")} />
            </label>
            <label className={label}>
              Currency
              <select
                name="currency"
                value={values.currency}
                onChange={(event) =>
                  setValues((current) => ({ ...current, currency: event.target.value as CardFormValues["currency"] }))
                }
                className={input}
              >
                <option value="CAD">CAD</option>
                <option value="USD">USD</option>
                <option value="JMD">JMD</option>
              </select>
            </label>
            <label className={label}>
              Country (2-letter)
              <input
                name="country"
                required
                pattern="[A-Z]{2}"
                value={values.country}
                onChange={(event) => setValues((current) => ({ ...current, country: event.target.value.toUpperCase() }))}
                className={input}
              />
              <ErrorText error={fieldError(state, "country")} />
            </label>
          </div>
        </details>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="font-medium">Rewards</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These numbers power the picker, annual-fee verdict, and cap tracker.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className={label}>
            Base earn rate (points/$)
            <input
              type="number"
              min="0"
              max="10"
              step="0.01"
              required
              value={values.rewards.baseMultiplier}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  rewards: { ...current.rewards, baseMultiplier: event.target.value },
                }))
              }
              className={input}
            />
            <ErrorText error={fieldError(state, "rewards.baseMultiplier")} />
          </label>
          <label className={label}>
            Point value (¢)
            <input
              type="number"
              min="0.01"
              max="10"
              step="0.01"
              required
              value={values.rewards.pointValueCents}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  rewards: { ...current.rewards, pointValueCents: event.target.value },
                }))
              }
              className={input}
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              What one point is worth in cents: use 1 for plain cashback, so the multiplier reads as a percentage;
              use 1.5 when each point is worth 1.5¢.
            </span>
            <ErrorText error={fieldError(state, "rewards.pointValueCents")} />
          </label>
          <label className={label}>
            Foreign transaction fee (%)
            <input
              type="number"
              min="0"
              max="5"
              step="0.01"
              required
              value={values.rewards.fxFeePct}
              onChange={(event) =>
                setValues((current) => ({ ...current, rewards: { ...current.rewards, fxFeePct: event.target.value } }))
              }
              className={input}
            />
            <ErrorText error={fieldError(state, "rewards.fxFeePct")} />
          </label>
        </div>

        <div data-testid="conditions-form" className="space-y-3 rounded border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">Wallet conditions</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Add account or eligibility states that change your rewards. You can turn them on or off from the card page later.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setValues((current) => ({
                  ...current,
                  rewards: {
                    ...current.rewards,
                    conditions: [
                      ...current.rewards.conditions,
                      { id: newId("condition", current.rewards.conditions), label: "", enabled: true, annualFeeReduction: "" },
                    ],
                  },
                }))
              }
              className="rounded border px-3 py-1 text-sm hover:bg-muted/50"
            >
              Add condition
            </button>
          </div>

          {values.rewards.conditions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No account conditions yet.</p>
          ) : (
            <div className="space-y-3">
              {values.rewards.conditions.map((condition, index) => (
                <div key={condition.id} className="grid gap-3 rounded bg-muted/40 p-3 sm:grid-cols-[1.6fr_auto_1fr_auto] sm:items-end">
                  <label className={label}>
                    Condition
                    <input
                      required
                      value={condition.label}
                      placeholder="e.g. Savings account linked"
                      onChange={(event) => updateCondition(index, { label: event.target.value })}
                      className={input}
                    />
                    <ErrorText error={fieldError(state, `rewards.conditions.${index}.label`)} />
                  </label>
                  <label className="flex min-h-10 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={condition.enabled}
                      onChange={(event) => updateCondition(index, { enabled: event.target.checked })}
                    />
                    Active now
                  </label>
                  <label className={label}>
                    Annual-fee reduction ($, optional)
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={condition.annualFeeReduction}
                      onChange={(event) => updateCondition(index, { annualFeeReduction: event.target.value })}
                      className={input}
                    />
                    <span className="mt-1 block text-xs text-muted-foreground">Subtracts from the published fee while active.</span>
                    <ErrorText error={fieldError(state, `rewards.conditions.${index}.annualFeeReduction`)} />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setValues((current) => {
                        const removedId = current.rewards.conditions[index]?.id;
                        return {
                          ...current,
                          rewards: {
                            ...current.rewards,
                            conditions: current.rewards.conditions.filter((_, conditionIndex) => conditionIndex !== index),
                            categoryRates: current.rewards.categoryRates.map((rate) =>
                              rate.requiresConditionId === removedId ? { ...rate, requiresConditionId: "" } : rate,
                            ),
                            merchantRates: current.rewards.merchantRates.map((rate) =>
                              rate.requiresConditionId === removedId ? { ...rate, requiresConditionId: "" } : rate,
                            ),
                            baseRateOverrides: current.rewards.baseRateOverrides.filter(
                              (rate) => rate.requiresConditionId !== removedId,
                            ),
                          },
                        };
                      })
                    }
                    className="rounded border border-red-600 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div data-testid="all-spend-rate-form" className="space-y-3 rounded border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">All-spend conditional rates</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Use this when an active condition changes the standard rate on every purchase, such as a CRO lockup or a telecom-service bonus. Configured category and merchant bonuses still take priority.
              </p>
            </div>
            <button
              type="button"
              disabled={values.rewards.conditions.length === 0}
              onClick={() =>
                setValues((current) => ({
                  ...current,
                  rewards: {
                    ...current.rewards,
                    baseRateOverrides: [
                      ...current.rewards.baseRateOverrides,
                      {
                        id: newId("all-spend-rate", current.rewards.baseRateOverrides),
                        label: "",
                        multiplier: "",
                        requiresConditionId: current.rewards.conditions[0]?.id ?? "",
                        cap: "",
                        capWindow: "MONTH",
                      },
                    ],
                  },
                }))
              }
              className="rounded border px-3 py-1 text-sm hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add all-spend rate
            </button>
          </div>

          {values.rewards.baseRateOverrides.length === 0 ? (
            <p className="text-sm text-muted-foreground">No conditional all-spend rates.</p>
          ) : (
            <div className="space-y-3">
              {values.rewards.baseRateOverrides.map((rate, index) => (
                <div key={rate.id} className="grid gap-3 rounded bg-muted/40 p-3 sm:grid-cols-[1.5fr_1fr_1.2fr_1fr_1fr_auto] sm:items-end">
                  <label className={label}>
                    Rule name
                    <input
                      required
                      value={rate.label}
                      placeholder="e.g. CRO lockup rewards"
                      onChange={(event) => updateBaseRateOverride(index, { label: event.target.value })}
                      className={input}
                    />
                    <ErrorText error={fieldError(state, `rewards.baseRateOverrides.${index}.label`)} />
                  </label>
                  <label className={label}>
                    Earn rate (points/$)
                    <input
                      type="number"
                      min="0.01"
                      max="20"
                      step="0.01"
                      required
                      value={rate.multiplier}
                      onChange={(event) => updateBaseRateOverride(index, { multiplier: event.target.value })}
                      className={input}
                    />
                    <ErrorText error={fieldError(state, `rewards.baseRateOverrides.${index}.multiplier`)} />
                  </label>
                  <label className={label}>
                    Active when
                    <select value={rate.requiresConditionId} onChange={(event) => updateBaseRateOverride(index, { requiresConditionId: event.target.value })} className={input}>
                      {values.rewards.conditions.map((condition) => <option key={condition.id} value={condition.id}>{condition.label || "Unnamed condition"}</option>)}
                    </select>
                    <ErrorText error={fieldError(state, `rewards.baseRateOverrides.${index}.requiresConditionId`)} />
                  </label>
                  <label className={label}>
                    Spend cap ($, optional)
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={rate.cap}
                      onChange={(event) => updateBaseRateOverride(index, { cap: event.target.value })}
                      className={input}
                    />
                    <ErrorText error={fieldError(state, `rewards.baseRateOverrides.${index}.cap`)} />
                  </label>
                  <label className={label}>
                    Cap window
                    <select value={rate.capWindow} onChange={(event) => updateBaseRateOverride(index, { capWindow: event.target.value as "MONTH" | "YEAR" })} className={input}>
                      <option value="MONTH">Per month</option>
                      <option value="YEAR">Per year</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setValues((current) => ({
                        ...current,
                        rewards: {
                          ...current.rewards,
                          baseRateOverrides: current.rewards.baseRateOverrides.filter((_, rateIndex) => rateIndex !== index),
                        },
                      }))
                    }
                    className="rounded border border-red-600 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div data-testid="shared-cap-form" className="space-y-3 rounded border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">Shared spending caps</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Use one cap group when categories draw from the same spending limit, such as groceries and dining.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setValues((current) => ({
                  ...current,
                  rewards: {
                    ...current.rewards,
                    capGroups: [
                      ...current.rewards.capGroups,
                      { id: newId("cap-group", current.rewards.capGroups), label: "", cap: "", capWindow: "MONTH" },
                    ],
                  },
                }))
              }
              className="rounded border px-3 py-1 text-sm hover:bg-muted/50"
            >
              Add shared cap
            </button>
          </div>

          {values.rewards.capGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No shared caps. Individual category caps still work below.</p>
          ) : (
            <div className="space-y-3">
              {values.rewards.capGroups.map((group, index) => (
                <div key={group.id} className="grid gap-3 rounded bg-muted/40 p-3 sm:grid-cols-[1.5fr_1fr_1fr_auto] sm:items-end">
                  <label className={label}>
                    Cap name
                    <input
                      required
                      value={group.label}
                      placeholder="e.g. Food spend"
                      onChange={(event) => updateCapGroup(index, { label: event.target.value })}
                      className={input}
                    />
                    <ErrorText error={fieldError(state, `rewards.capGroups.${index}.label`)} />
                  </label>
                  <label className={label}>
                    Spend cap ($)
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={group.cap}
                      onChange={(event) => updateCapGroup(index, { cap: event.target.value })}
                      className={input}
                    />
                    <ErrorText error={fieldError(state, `rewards.capGroups.${index}.cap`)} />
                  </label>
                  <label className={label}>
                    Cap window
                    <select value={group.capWindow} onChange={(event) => updateCapGroup(index, { capWindow: event.target.value as "MONTH" | "YEAR" })} className={input}>
                      <option value="MONTH">Per month</option>
                      <option value="YEAR">Per year</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setValues((current) => ({
                        ...current,
                        rewards: {
                          ...current.rewards,
                          capGroups: current.rewards.capGroups.filter((_, groupIndex) => groupIndex !== index),
                          categoryRates: current.rewards.categoryRates.map((rate) =>
                            rate.capGroupId === group.id ? { ...rate, capGroupId: "" } : rate,
                          ),
                        },
                      }))
                    }
                    className="rounded border border-red-600 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div data-testid="bonus-category-form" className="space-y-3 rounded border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">Bonus categories</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Add every category that earns more than the base rate. A cap is spend the bonus rate applies to, not the reward earned.
              </p>
            </div>
            <button
              type="button"
              disabled={availableCategories.length === 0}
              onClick={() =>
                setValues((current) => ({
                  ...current,
                  rewards: {
                    ...current.rewards,
                    categoryRates: [
                      ...current.rewards.categoryRates,
                      {
                        category: availableCategories[0],
                        multiplier: "",
                        cap: "",
                        capWindow: "MONTH",
                        capGroupId: "",
                        requiresConditionId: "",
                      },
                    ],
                  },
                }))
              }
              className="rounded border px-3 py-1 text-sm hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add category
            </button>
          </div>

          {values.rewards.categoryRates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bonus categories yet.</p>
          ) : (
            <div className="space-y-3">
              {values.rewards.categoryRates.map((rate, index) => (
                <div key={rate.category} className="grid gap-3 rounded bg-muted/40 p-3 sm:grid-cols-[1.4fr_1fr_1fr_1fr_1.2fr_1.2fr_auto] sm:items-end">
                  <label className={label}>
                    Category
                    <select value={rate.category} onChange={(event) => updateCategory(index, { category: event.target.value as SpendCategory })} className={input}>
                      {SPEND_CATEGORIES.filter(
                        (category) => category === rate.category || availableCategories.includes(category),
                      ).map((category) => (
                        <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>
                      ))}
                    </select>
                  </label>
                  <label className={label}>
                    Earn rate (points/$)
                    <input
                      type="number"
                      min="0.01"
                      max="20"
                      step="0.01"
                      required
                      value={rate.multiplier}
                      onChange={(event) => updateCategory(index, { multiplier: event.target.value })}
                      className={input}
                    />
                    <ErrorText error={fieldError(state, `rewards.categoryRates.${index}.multiplier`)} />
                  </label>
                  <label className={label}>
                    Spend cap ($, optional)
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={rate.cap}
                      onChange={(event) => updateCategory(index, { cap: event.target.value })}
                      disabled={Boolean(rate.capGroupId)}
                      className={input}
                    />
                    <ErrorText error={fieldError(state, `rewards.categoryRates.${index}.cap`)} />
                  </label>
                  <label className={label}>
                    Cap window
                    <select value={rate.capWindow} onChange={(event) => updateCategory(index, { capWindow: event.target.value as "MONTH" | "YEAR" })} disabled={Boolean(rate.capGroupId)} className={input}>
                      <option value="MONTH">Per month</option>
                      <option value="YEAR">Per year</option>
                    </select>
                  </label>
                  <label className={label}>
                    Shared cap
                    <select
                      value={rate.capGroupId}
                      onChange={(event) => updateCategory(index, { capGroupId: event.target.value, cap: event.target.value ? "" : rate.cap })}
                      className={input}
                    >
                      <option value="">Individual / none</option>
                      {values.rewards.capGroups.map((group) => <option key={group.id} value={group.id}>{group.label || "Unnamed shared cap"}</option>)}
                    </select>
                    <ErrorText error={fieldError(state, `rewards.categoryRates.${index}.capGroupId`)} />
                  </label>
                  <label className={label}>
                    Active when
                    <select value={rate.requiresConditionId} onChange={(event) => updateCategory(index, { requiresConditionId: event.target.value })} className={input}>
                      <option value="">Always active</option>
                      {values.rewards.conditions.map((condition) => <option key={condition.id} value={condition.id}>{condition.label || "Unnamed condition"}</option>)}
                    </select>
                    <ErrorText error={fieldError(state, `rewards.categoryRates.${index}.requiresConditionId`)} />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setValues((current) => ({
                        ...current,
                        rewards: {
                          ...current.rewards,
                          categoryRates: current.rewards.categoryRates.filter((_, rateIndex) => rateIndex !== index),
                        },
                      }))
                    }
                    className="rounded border border-red-600 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div data-testid="merchant-bonus-form" className="space-y-3 rounded border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">Merchant-specific bonuses</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Add a bonus that only applies at specific merchants. Separate merchant names with commas to share one rate, such as Canadian Tire, Sport Chek, and Mark&apos;s.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setValues((current) => ({
                  ...current,
                  rewards: {
                    ...current.rewards,
                    merchantRates: [
                      ...current.rewards.merchantRates,
                      { id: newId("merchant", current.rewards.merchantRates), merchant: "", multiplier: "", requiresConditionId: "" },
                    ],
                  },
                }))
              }
              className="rounded border px-3 py-1 text-sm hover:bg-muted/50"
            >
              Add merchant bonus
            </button>
          </div>

          {values.rewards.merchantRates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No merchant-specific bonuses.</p>
          ) : (
            <div className="space-y-3">
              {values.rewards.merchantRates.map((rate, index) => (
                <div key={rate.id} className="grid gap-3 rounded bg-muted/40 p-3 sm:grid-cols-[1.5fr_1fr_1.2fr_auto] sm:items-end">
                  <label className={label}>
                    Merchant
                    <input
                      required
                      value={rate.merchant}
                      placeholder="e.g. Canadian Tire"
                      onChange={(event) => updateMerchantRate(index, { merchant: event.target.value })}
                      className={input}
                    />
                    <ErrorText error={fieldError(state, `rewards.merchantRates.${index}.merchant`)} />
                  </label>
                  <label className={label}>
                    Earn rate (points/$)
                    <input
                      type="number"
                      min="0.01"
                      max="20"
                      step="0.01"
                      required
                      value={rate.multiplier}
                      onChange={(event) => updateMerchantRate(index, { multiplier: event.target.value })}
                      className={input}
                    />
                    <ErrorText error={fieldError(state, `rewards.merchantRates.${index}.multiplier`)} />
                  </label>
                  <label className={label}>
                    Active when
                    <select value={rate.requiresConditionId} onChange={(event) => updateMerchantRate(index, { requiresConditionId: event.target.value })} className={input}>
                      <option value="">Always active</option>
                      {values.rewards.conditions.map((condition) => <option key={condition.id} value={condition.id}>{condition.label || "Unnamed condition"}</option>)}
                    </select>
                    <ErrorText error={fieldError(state, `rewards.merchantRates.${index}.requiresConditionId`)} />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setValues((current) => ({
                        ...current,
                        rewards: {
                          ...current.rewards,
                          merchantRates: current.rewards.merchantRates.filter((_, rateIndex) => rateIndex !== index),
                        },
                      }))
                    }
                    className="rounded border border-red-600 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div data-testid="credit-form" className="space-y-3 rounded border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">Recurring credits & benefits</h3>
              <p className="mt-1 text-xs text-muted-foreground">Add each monthly or annual credit, then mark it redeemed from the card page when you use it.</p>
            </div>
            <button
              type="button"
              onClick={() =>
                setValues((current) => ({
                  ...current,
                  rewards: {
                    ...current.rewards,
                    credits: [
                      ...current.rewards.credits,
                      { id: newCreditId(current.rewards.credits), label: "", value: "", period: "YEAR" },
                    ],
                  },
                }))
              }
              className="rounded border px-3 py-1 text-sm hover:bg-muted/50"
            >
              Add credit
            </button>
          </div>

          {values.rewards.credits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recurring credits.</p>
          ) : (
            <div className="space-y-3">
              {values.rewards.credits.map((credit, index) => (
                <div key={credit.id} className="grid gap-3 rounded bg-muted/40 p-3 sm:grid-cols-[1.8fr_1fr_1fr_auto] sm:items-end">
                  <label className={label}>
                    Credit name
                    <input
                      required
                      value={credit.label}
                      onChange={(event) => updateCredit(index, { label: event.target.value })}
                      className={input}
                    />
                    <ErrorText error={fieldError(state, `rewards.credits.${index}.label`)} />
                  </label>
                  <label className={label}>
                    Value ($)
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={credit.value}
                      onChange={(event) => updateCredit(index, { value: event.target.value })}
                      className={input}
                    />
                    <ErrorText error={fieldError(state, `rewards.credits.${index}.value`)} />
                  </label>
                  <label className={label}>
                    Frequency
                    <select value={credit.period} onChange={(event) => updateCredit(index, { period: event.target.value as CreditForm["period"] })} className={input}>
                      <option value="YEAR">Annual</option>
                      <option value="MONTH">Monthly</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setValues((current) => ({
                        ...current,
                        rewards: {
                          ...current.rewards,
                          credits: current.rewards.credits.filter((_, creditIndex) => creditIndex !== index),
                        },
                      }))
                    }
                    className="rounded border border-red-600 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <button disabled={isPending} type="submit" className="rounded bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">
          {isPending ? "Saving…" : mode === "create" ? "Add card" : "Save changes"}
        </button>
        <Link href={returnHref} className="rounded border px-4 py-2 text-sm hover:bg-muted/50">Cancel</Link>
      </div>
    </form>
  );
}
