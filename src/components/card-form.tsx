"use client";

import Link from "next/link";
import { useActionState, useState, type Dispatch, type SetStateAction } from "react";
import { Plus, ChevronDown, ChevronUp, Sparkles, Shield, Tag, HelpCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createCard, type CardFormState, updateCard } from "@/app/cards/actions";
import { CATEGORY_LABELS, SPEND_CATEGORIES, type Network, type SpendCategory } from "@/lib/cards/types";
import { CATEGORY_ICONS, type CardPreset } from "@/lib/cards/presets";
import { CardPresetSelector } from "@/components/cards/card-preset-selector";
import { CardPreview } from "@/components/cards/card-preview";

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
  feeMonthDay: string;
  feeCancelGraceDays: string;
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

const input =
  "mt-1 flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50";
const label = "block text-xs font-medium text-foreground";
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
  feeMonthDay: "",
  feeCancelGraceDays: "30",
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

function optional(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
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

function fieldError(state: CardFormState, path: string) {
  return state.fieldErrors?.[path];
}

function ErrorText({ error, id }: { error?: string; id?: string }) {
  return error ? <p id={id} className="mt-1 text-xs font-medium text-red-600">{error}</p> : null;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function FeeRenewalFields({
  values,
  setValues,
  state,
}: {
  values: CardFormValues;
  setValues: Dispatch<SetStateAction<CardFormValues>>;
  state: CardFormState;
}) {
  const [month = "", day = ""] = values.feeMonthDay ? values.feeMonthDay.split("-") : [];
  const fee = parseFloat(values.annualFee) || 0;
  const [showForZeroFee, setShowForZeroFee] = useState(Boolean(values.feeMonthDay));

  const setPart = (next: { month?: string; day?: string }) => {
    const m = next.month ?? month;
    const d = next.day ?? day;
    setValues((current) => ({ ...current, feeMonthDay: m && d ? `${m}-${d}` : "" }));
  };

  if (fee === 0 && !showForZeroFee) {
    return (
      <div className="rounded-lg border border-border/70 bg-muted/10 p-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">$0 Annual fee:</span> Renewal tracking not required.
        </p>
        <button
          type="button"
          onClick={() => setShowForZeroFee(true)}
          className="text-xs font-medium text-primary hover:underline cursor-pointer"
        >
          Track anniversary anyway
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/80 bg-muted/20 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-foreground">Annual fee renewal timing</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Tracks when the annual fee posts so MoneyTalks can notify you before cancellation/retention deadlines.
          </p>
        </div>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <label className={label}>
          Renewal Month
          <select
            name="feeMonthDayMonth"
            value={month}
            onChange={(event) => setPart({ month: event.target.value })}
            className={input}
          >
            <option value="">— Choose month —</option>
            {MONTHS.map((name, index) => (
              <option key={name} value={String(index + 1).padStart(2, "0")}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Renewal Day
          <select
            name="feeMonthDayDay"
            value={day}
            onChange={(event) => setPart({ day: event.target.value })}
            className={input}
          >
            <option value="">— Choose day —</option>
            {Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(2, "0")).map((d) => (
              <option key={d} value={d}>
                {Number(d)}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Cancel window (days)
          <input
            name="feeCancelGraceDays"
            type="number"
            min="0"
            max="180"
            value={values.feeCancelGraceDays}
            onChange={(event) =>
              setValues((current) => ({ ...current, feeCancelGraceDays: event.target.value }))
            }
            className={input}
          />
          <ErrorText error={fieldError(state, "feeCancelGraceDays")} />
        </label>
      </div>
      <input type="hidden" name="feeMonthDay" value={values.feeMonthDay} />
      <ErrorText error={fieldError(state, "feeMonthDay")} />
      <p className="mt-2 text-[11px] text-muted-foreground">
        Most issuers refund the fee if you cancel or product-switch within ~30 days of posting.
      </p>
    </div>
  );
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
  
  // Advanced Accordion states
  const hasAdvancedData =
    values.rewards.capGroups.length > 0 ||
    values.rewards.conditions.length > 0 ||
    values.rewards.baseRateOverrides.length > 0 ||
    values.rewards.merchantRates.length > 0;
  const [showAdvanced, setShowAdvanced] = useState(hasAdvancedData);
  const [showOptionalAccountDetails, setShowOptionalAccountDetails] = useState(
    Boolean(values.lastFour || values.limit || values.statementDay || values.dueDay || values.aprPct)
  );

  const availableCategories = SPEND_CATEGORIES.filter(
    (category) => !values.rewards.categoryRates.some((rate) => rate.category === category)
  );
  const returnHref = mode === "edit" && cardId ? `/cards/${cardId}` : "/cards/manage";

  function handleSelectPreset(preset: CardPreset) {
    setValues(structuredClone(preset.values));
    setShowAdvanced(
      preset.values.rewards.capGroups.length > 0 ||
      preset.values.rewards.conditions.length > 0 ||
      preset.values.rewards.baseRateOverrides.length > 0 ||
      preset.values.rewards.merchantRates.length > 0
    );
  }

  function handleResetToBlank() {
    setValues(structuredClone(emptyCard));
    setShowAdvanced(false);
  }

  function addCategory(cat: SpendCategory) {
    setValues((current) => ({
      ...current,
      rewards: {
        ...current.rewards,
        categoryRates: [
          ...current.rewards.categoryRates,
          {
            category: cat,
            multiplier: "2",
            cap: "",
            capWindow: "MONTH",
            capGroupId: "",
            requiresConditionId: "",
          },
        ],
      },
    }));
  }

  function updateCategory(index: number, update: Partial<CategoryRateForm>) {
    setValues((current) => ({
      ...current,
      rewards: {
        ...current.rewards,
        categoryRates: current.rewards.categoryRates.map((rate, rateIndex) =>
          rateIndex === index ? { ...rate, ...update } : rate
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
          creditIndex === index ? { ...credit, ...update } : credit
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
          groupIndex === index ? { ...group, ...update } : group
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
          conditionIndex === index ? { ...condition, ...update } : condition
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
          rateIndex === index ? { ...rate, ...update } : rate
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
          rateIndex === index ? { ...rate, ...update } : rate
        ),
      },
    }));
  }

  return (
    <div className="space-y-8">
      {/* Preset Autofill Selector (Only in Create Mode) */}
      {mode === "create" && (
        <CardPresetSelector
          currentValues={values}
          onSelectPreset={handleSelectPreset}
          onResetToBlank={handleResetToBlank}
        />
      )}

      {/* Main Two-Column Layout: Form on Left, Live Preview on Right */}
      <div className="grid gap-8 lg:grid-cols-[1fr_360px] items-start">
        {/* Left Column: Form Controls */}
        <form action={formAction} className="space-y-6">
          <input type="hidden" name="cardJson" value={JSON.stringify(toPayload(values))} />
          {mode === "edit" ? <input type="hidden" name="cardId" value={cardId} /> : null}

          {state.error && !state.fieldErrors?.nickname ? (
            <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs font-medium text-red-600">
              {state.error}
            </div>
          ) : null}

          {/* Section 1: Card Core Details */}
          <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs space-y-4">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Card details</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Basic information, issuer, and annual fee schedule.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={label}>
                Nickname
                <input
                  name="nickname"
                  required
                  placeholder="e.g. Cobalt Card"
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
                  placeholder="e.g. American Express"
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

            <FeeRenewalFields values={values} setValues={setValues} state={state} />

            {/* Optional Account Details Accordion */}
            <div className="border-t border-border/60 pt-3">
              <button
                type="button"
                onClick={() => setShowOptionalAccountDetails(!showOptionalAccountDetails)}
                className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
              >
                {showOptionalAccountDetails ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                <span>Optional account details (last 4, credit limit, billing days, APR)</span>
              </button>

              {showOptionalAccountDetails && (
                <div className="mt-3 grid gap-4 sm:grid-cols-2 rounded-lg border border-border/80 bg-muted/20 p-4">
                  <label className={label}>
                    Last four digits
                    <input
                      name="lastFour"
                      inputMode="numeric"
                      pattern="[0-9]{4}"
                      maxLength={4}
                      placeholder="e.g. 1234"
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
                      placeholder="e.g. 10000"
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
                      placeholder="1 - 28"
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
                      placeholder="1 - 28"
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
                      placeholder="e.g. 20.99"
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
                </div>
              )}
            </div>
          </section>

          {/* Section 2: Rewards & Multipliers */}
          <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs space-y-5">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Rewards &amp; Earn Multipliers</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Powers card comparison, transaction recommendation picker, and cap tracking.
              </p>
            </div>

            {/* Core Multiplier Inputs */}
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

            {/* Quick Point Valuation Helper Bar */}
            <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-foreground">
                  Quick Point Valuation Presets
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Current: 1 pt = {values.rewards.pointValueCents || "1"}¢ CAD
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: "Cashback / Scene+ (1.0¢)", val: "1" },
                  { label: "Avion / Travel (1.5¢)", val: "1.5" },
                  { label: "Aeroplan (1.8¢)", val: "1.8" },
                  { label: "Amex MR / Flight Transfer (2.0¢)", val: "2" },
                ].map((preset) => (
                  <button
                    key={preset.val}
                    type="button"
                    onClick={() =>
                      setValues((current) => ({
                        ...current,
                        rewards: { ...current.rewards, pointValueCents: preset.val },
                      }))
                    }
                    className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                      values.rewards.pointValueCents === preset.val
                        ? "bg-primary text-primary-foreground font-semibold shadow-2xs"
                        : "bg-background text-muted-foreground hover:text-foreground border border-border/80"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Bonus Categories Form */}
            <div data-testid="bonus-category-form" className="space-y-3 rounded-lg border border-border/80 bg-muted/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Bonus Categories
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Category rates that earn more than the base multiplier.
                  </p>
                </div>
              </div>

              {/* Category Quick-Add Chips */}
              {availableCategories.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-[11px] font-medium text-muted-foreground">Quick-add category:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {availableCategories.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => addCategory(cat)}
                        className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-background px-2 py-1 text-xs font-medium text-foreground shadow-2xs hover:bg-muted cursor-pointer transition-colors"
                      >
                        <Plus className="size-3 text-primary" />
                        <span>{CATEGORY_ICONS[cat] || "💳"}</span>
                        <span>{CATEGORY_LABELS[cat]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {values.rewards.categoryRates.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2 italic">
                  No bonus categories added yet. Click any chip above or configure a custom category below.
                </p>
              ) : (
                <div className="space-y-3 pt-2">
                  {values.rewards.categoryRates.map((rate, index) => (
                    <div
                      key={rate.category}
                      className="rounded-lg bg-background p-3 border border-border/70 shadow-2xs space-y-3"
                    >
                      {/* Top row of category item */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{CATEGORY_ICONS[rate.category] || "💳"}</span>
                          <span className="text-xs font-bold text-foreground">
                            {CATEGORY_LABELS[rate.category]}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-muted-foreground">Earn:</span>
                            <input
                              type="number"
                              min="0.01"
                              max="20"
                              step="0.01"
                              required
                              value={rate.multiplier}
                              onChange={(event) => updateCategory(index, { multiplier: event.target.value })}
                              className="h-8 w-20 rounded-md border border-input bg-background px-2 text-xs font-bold text-foreground text-center"
                            />
                            <span className="text-xs font-semibold text-foreground">pts/$</span>
                          </div>

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
                            className="inline-flex h-8 items-center justify-center rounded-md border border-destructive/30 bg-destructive/5 px-2.5 text-xs font-medium text-destructive hover:bg-destructive/15 cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      </div>

                      {/* Bottom row: Spend Cap & Conditions */}
                      <div className="grid gap-3 pt-2 border-t border-border/50 sm:grid-cols-3">
                        <label className={label}>
                          Spend cap ($, optional)
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            placeholder="e.g. 2500"
                            value={rate.cap}
                            onChange={(event) => updateCategory(index, { cap: event.target.value })}
                            disabled={Boolean(rate.capGroupId)}
                            className={input}
                          />
                          <ErrorText error={fieldError(state, `rewards.categoryRates.${index}.cap`)} />
                        </label>

                        <label className={label}>
                          Cap window
                          <select
                            value={rate.capWindow}
                            onChange={(event) => updateCategory(index, { capWindow: event.target.value as "MONTH" | "YEAR" })}
                            disabled={Boolean(rate.capGroupId)}
                            className={input}
                          >
                            <option value="MONTH">Per month</option>
                            <option value="YEAR">Per year</option>
                          </select>
                        </label>

                        <label className={label}>
                          Shared cap group
                          <select
                            value={rate.capGroupId}
                            onChange={(event) =>
                              updateCategory(index, { capGroupId: event.target.value, cap: event.target.value ? "" : rate.cap })
                            }
                            className={input}
                          >
                            <option value="">None (Individual cap)</option>
                            {values.rewards.capGroups.map((group) => (
                              <option key={group.id} value={group.id}>
                                {group.label || "Unnamed shared cap"}
                              </option>
                            ))}
                          </select>
                          <ErrorText error={fieldError(state, `rewards.categoryRates.${index}.capGroupId`)} />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recurring Credits Form */}
            <div data-testid="credit-form" className="space-y-3 rounded-lg border border-border/80 bg-muted/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Recurring Credits &amp; Statement Benefits
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Statement credits (e.g. $200 travel credit, dining credits) that offset the annual fee.
                  </p>
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
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-border/80 bg-background px-2.5 text-xs font-semibold text-foreground shadow-2xs hover:bg-muted cursor-pointer"
                >
                  <Plus className="size-3" />
                  <span>Add credit</span>
                </button>
              </div>

              {values.rewards.credits.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">No recurring statement credits.</p>
              ) : (
                <div className="space-y-3">
                  {values.rewards.credits.map((credit, index) => (
                    <div key={credit.id} className="grid gap-3 rounded-lg bg-background p-3 border border-border/60 sm:grid-cols-[1.8fr_1fr_1fr_auto] sm:items-end">
                      <label className={label}>
                        Credit name
                        <input
                          required
                          value={credit.label}
                          placeholder="e.g. Annual Travel Credit"
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
                          placeholder="200.00"
                          value={credit.value}
                          onChange={(event) => updateCredit(index, { value: event.target.value })}
                          className={input}
                        />
                        <ErrorText error={fieldError(state, `rewards.credits.${index}.value`)} />
                      </label>
                      <label className={label}>
                        Frequency
                        <select
                          value={credit.period}
                          onChange={(event) => updateCredit(index, { period: event.target.value as CreditForm["period"] })}
                          className={input}
                        >
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
                        className="inline-flex h-9 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-3 text-xs font-semibold text-destructive shadow-2xs hover:bg-destructive/15 cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Section 3: Advanced Rules & Custom Conditions Accordion */}
          <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold tracking-tight">Advanced Perks &amp; Rules</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Shared spend ceilings, conditional fee waivers, all-spend overrides, and merchant bonuses.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer"
              >
                {showAdvanced ? "Hide advanced" : "Show advanced"}
                {showAdvanced ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </button>
            </div>

            {showAdvanced && (
              <div className="space-y-5 pt-2 border-t border-border/60">
                {/* Shared Cap Form */}
                <div data-testid="shared-cap-form" className="space-y-3 rounded-lg border border-border/80 bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Shared spending caps</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Group multiple categories under one shared spend ceiling (e.g. Dining &amp; Groceries).
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
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-border/80 bg-background px-2.5 text-xs font-semibold text-foreground shadow-2xs hover:bg-muted cursor-pointer"
                    >
                      <Plus className="size-3" />
                      <span>Add shared cap</span>
                    </button>
                  </div>

                  {values.rewards.capGroups.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-1">No shared caps configured.</p>
                  ) : (
                    <div className="space-y-3">
                      {values.rewards.capGroups.map((group, index) => (
                        <div key={group.id} className="grid gap-3 rounded-lg bg-background p-3 border border-border/60 sm:grid-cols-[1.5fr_1fr_1fr_auto] sm:items-end">
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
                            <select
                              value={group.capWindow}
                              onChange={(event) => updateCapGroup(index, { capWindow: event.target.value as "MONTH" | "YEAR" })}
                              className={input}
                            >
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
                                    rate.capGroupId === group.id ? { ...rate, capGroupId: "" } : rate
                                  ),
                                },
                              }))
                            }
                            className="inline-flex h-9 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-3 text-xs font-semibold text-destructive shadow-2xs hover:bg-destructive/15 cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Wallet Conditions Form */}
                <div data-testid="conditions-form" className="space-y-3 rounded-lg border border-border/80 bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Wallet conditions</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Account eligibility states that modify rewards or waive fees (e.g. banking tier fee waiver).
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
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-border/80 bg-background px-2.5 text-xs font-semibold text-foreground shadow-2xs hover:bg-muted cursor-pointer"
                    >
                      <Plus className="size-3" />
                      <span>Add condition</span>
                    </button>
                  </div>

                  {values.rewards.conditions.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-1">No account conditions configured.</p>
                  ) : (
                    <div className="space-y-3">
                      {values.rewards.conditions.map((condition, index) => (
                        <div key={condition.id} className="grid gap-3 rounded-lg bg-background p-3 border border-border/60 sm:grid-cols-[1.6fr_auto_1fr_auto] sm:items-end">
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
                          <label className="flex min-h-9 items-center gap-2 text-xs font-medium cursor-pointer">
                            <input
                              type="checkbox"
                              checked={condition.enabled}
                              onChange={(event) => updateCondition(index, { enabled: event.target.checked })}
                              className="rounded"
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
                                      rate.requiresConditionId === removedId ? { ...rate, requiresConditionId: "" } : rate
                                    ),
                                    merchantRates: current.rewards.merchantRates.map((rate) =>
                                      rate.requiresConditionId === removedId ? { ...rate, requiresConditionId: "" } : rate
                                    ),
                                    baseRateOverrides: current.rewards.baseRateOverrides.filter(
                                      (rate) => rate.requiresConditionId !== removedId
                                    ),
                                  },
                                };
                              })
                            }
                            className="inline-flex h-9 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-3 text-xs font-semibold text-destructive shadow-2xs hover:bg-destructive/15 cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* All Spend Rates Form */}
                <div data-testid="all-spend-rate-form" className="space-y-3 rounded-lg border border-border/80 bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">All-spend conditional rates</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Rates that override the base rate across all spend when a condition is met (e.g. Rogers service).
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
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-border/80 bg-background px-2.5 text-xs font-semibold text-foreground shadow-2xs hover:bg-muted disabled:opacity-50 cursor-pointer"
                    >
                      <Plus className="size-3" />
                      <span>Add all-spend rate</span>
                    </button>
                  </div>

                  {values.rewards.baseRateOverrides.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-1">No conditional all-spend rates.</p>
                  ) : (
                    <div className="space-y-3">
                      {values.rewards.baseRateOverrides.map((rate, index) => (
                        <div key={rate.id} className="grid gap-3 rounded-lg bg-background p-3 border border-border/60 sm:grid-cols-[1.5fr_1fr_1.2fr_1fr_1fr_auto] sm:items-end">
                          <label className={label}>
                            Rule name
                            <input
                              required
                              value={rate.label}
                              placeholder="e.g. Rogers linked 2%"
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
                            <select
                              value={rate.requiresConditionId}
                              onChange={(event) => updateBaseRateOverride(index, { requiresConditionId: event.target.value })}
                              className={input}
                            >
                              {values.rewards.conditions.map((condition) => (
                                <option key={condition.id} value={condition.id}>
                                  {condition.label || "Unnamed condition"}
                                </option>
                              ))}
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
                            <select
                              value={rate.capWindow}
                              onChange={(event) => updateBaseRateOverride(index, { capWindow: event.target.value as "MONTH" | "YEAR" })}
                              className={input}
                            >
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
                            className="inline-flex h-9 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-3 text-xs font-semibold text-destructive shadow-2xs hover:bg-destructive/15 cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Merchant Bonuses Form */}
                <div data-testid="merchant-bonus-form" className="space-y-3 rounded-lg border border-border/80 bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Merchant-specific bonuses</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Bonuses that apply at specific merchants (e.g. Canadian Tire, Spotify).
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
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-border/80 bg-background px-2.5 text-xs font-semibold text-foreground shadow-2xs hover:bg-muted cursor-pointer"
                    >
                      <Plus className="size-3" />
                      <span>Add merchant bonus</span>
                    </button>
                  </div>

                  {values.rewards.merchantRates.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-1">No merchant-specific bonuses.</p>
                  ) : (
                    <div className="space-y-3">
                      {values.rewards.merchantRates.map((rate, index) => (
                        <div key={rate.id} className="grid gap-3 rounded-lg bg-background p-3 border border-border/60 sm:grid-cols-[1.5fr_1fr_1.2fr_auto] sm:items-end">
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
                            <select
                              value={rate.requiresConditionId}
                              onChange={(event) => updateMerchantRate(index, { requiresConditionId: event.target.value })}
                              className={input}
                            >
                              <option value="">Always active</option>
                              {values.rewards.conditions.map((condition) => (
                                <option key={condition.id} value={condition.id}>
                                  {condition.label || "Unnamed condition"}
                                </option>
                              ))}
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
                            className="inline-flex h-9 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-3 text-xs font-semibold text-destructive shadow-2xs hover:bg-destructive/15 cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Form Submit & Cancel Controls */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              disabled={isPending}
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-foreground px-6 text-sm font-semibold text-background shadow-xs hover:bg-foreground/90 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isPending ? "Saving…" : mode === "create" ? "Add card to wallet" : "Save changes"}
            </button>
            <Button asChild variant="outline" size="default">
              <Link href={returnHref}>Cancel</Link>
            </Button>
          </div>
        </form>

        {/* Right Column: Sticky Live Card Preview & Info Card */}
        <aside className="space-y-4 lg:sticky lg:top-6">
          <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5 shadow-2xs">
            <CardPreview values={values} />
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-2 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-primary" />
              <span>How MoneyTalks uses this data</span>
            </p>
            <ul className="list-disc pl-4 space-y-1 text-[11px] leading-relaxed">
              <li>
                <strong>Optimal Card Picker:</strong> Recommends the highest earning card at checkout based on category multipliers &amp; caps.
              </li>
              <li>
                <strong>Annual Fee Countdown:</strong> Alerts you before the renewal fee posts so you have time to cancel or negotiate.
              </li>
              <li>
                <strong>Cap Tracking:</strong> Alerts you when you are close to exhausting category spend limits.
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
