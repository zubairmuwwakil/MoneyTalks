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
};

type CreditForm = {
  id: string;
  label: string;
  value: string;
  period: "YEAR" | "MONTH";
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
      categoryRates: values.rewards.categoryRates.map(({ cap, capWindow, ...rate }) => {
        const spendCap = optional(cap);
        return spendCap === undefined ? rate : { ...rate, cap: spendCap, capWindow };
      }),
      credits: values.rewards.credits,
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
                      { category: availableCategories[0], multiplier: "", cap: "", capWindow: "MONTH" },
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
                <div key={rate.category} className="grid gap-3 rounded bg-muted/40 p-3 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto] sm:items-end">
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
                      className={input}
                    />
                    <ErrorText error={fieldError(state, `rewards.categoryRates.${index}.cap`)} />
                  </label>
                  <label className={label}>
                    Cap window
                    <select value={rate.capWindow} onChange={(event) => updateCategory(index, { capWindow: event.target.value as "MONTH" | "YEAR" })} className={input}>
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

        <div data-testid="credit-form" className="space-y-3 rounded border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">Recurring credits</h3>
              <p className="mt-1 text-xs text-muted-foreground">Only add credits you genuinely redeem.</p>
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
