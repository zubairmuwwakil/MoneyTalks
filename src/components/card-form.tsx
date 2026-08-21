"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Loader2, CreditCard, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { createCard, updateCard, type CardFormState } from "@/app/cards/actions";
import {
  type CatalogueChoice,
  getCardPerksSummary,
  type CardPerksSummary,
} from "@/lib/cards/catalogueCard";
import { minorToDollarInput } from "@/engine/money";
import type { Network } from "@/lib/cards/types";
import { CardImage } from "@/components/cards/card-image";
import { CardPicker } from "@/components/cards/card-picker";
import { Button } from "@/components/ui/button";

export type CardFormValues = {
  contractCardId: string;
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
  feeRebate: string;
  feeMonthDay: string;
  feeCancelGraceDays: string;
};

export const emptyCardFormValues: CardFormValues = {
  contractCardId: "",
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
  annualFee: "0",
  feeRebate: "0",
  feeMonthDay: "",
  feeCancelGraceDays: "30",
};

const inputBase =
  "mt-1 flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50";
const labelBase = "block text-xs font-semibold text-foreground";
const initialCardFormState: CardFormState = {};

// ── Inline validation helpers ───────────────────────────────────────────
type BlurErrors = Record<string, string | undefined>;
const MONTH_DAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const FOUR_DIGITS_RE = /^\d{4}$/;

function validateField(name: string, value: string, values: CardFormValues): string | undefined {
  switch (name) {
    case "nickname":
      return value.trim() === "" ? "Nickname is required" : undefined;
    case "lastFour":
      return value && !FOUR_DIGITS_RE.test(value) ? "Must be exactly 4 digits" : undefined;
    case "feeMonthDay":
      return value && !MONTH_DAY_RE.test(value) ? "Use MM-DD format, e.g. 03-15" : undefined;
    case "feeRebate": {
      const rebate = parseFloat(value);
      const fee = parseFloat(values.annualFee);
      return !isNaN(rebate) && !isNaN(fee) && rebate > fee
        ? "Rebate cannot exceed the annual fee"
        : undefined;
    }
    default:
      return undefined;
  }
}

export function CardForm({
  mode,
  cardId,
  choices,
  initialValues = emptyCardFormValues,
}: {
  mode: "create" | "edit";
  cardId?: string;
  choices: CatalogueChoice[];
  initialValues?: CardFormValues;
}) {
  const [values, setValues] = useState<CardFormValues>(initialValues);
  const action = mode === "create" ? createCard : updateCard;
  const [state, formAction, isPending] = useActionState(action, initialCardFormState);
  const [showOptional, setShowOptional] = useState(
    Boolean(values.lastFour || values.limit || values.statementDay || values.dueDay || values.aprPct),
  );
  const [blurErrors, setBlurErrors] = useState<BlurErrors>({});
  const [nicknameAutoFilled, setNicknameAutoFilled] = useState(false);
  const firstErrorRef = useRef<HTMLParagraphElement>(null);

  const selected = choices.find((c) => c.contractCardId === values.contractCardId) ?? null;
  const perks: CardPerksSummary | null = useMemo(
    () => getCardPerksSummary(values.contractCardId),
    [values.contractCardId],
  );

  const returnHref = mode === "edit" && cardId ? `/cards/${cardId}` : "/cards/manage";

  // ── Toast on server error ────────────────────────────────────────────
  useEffect(() => {
    if (state.error) {
      toast.error(state.error);
      setTimeout(() => firstErrorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    }
  }, [state.error]);

  function set<K extends keyof CardFormValues>(key: K, value: CardFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    if (blurErrors[key]) {
      setBlurErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  }

  function handleBlur(name: string) {
    const error = validateField(name, (values as Record<string, string>)[name] ?? "", values);
    setBlurErrors((prev) => ({ ...prev, [name]: error }));
  }

  function selectCatalogueCard(contractCardId: string) {
    const choice = choices.find((c) => c.contractCardId === contractCardId);
    if (!choice) {
      set("contractCardId", "");
      setNicknameAutoFilled(false);
      return;
    }
    setValues((current) => {
      const willAutoFill = current.nickname.trim() === "" || nicknameAutoFilled;
      if (willAutoFill) setNicknameAutoFilled(true);
      return {
        ...current,
        contractCardId: choice.contractCardId,
        issuer: choice.issuer,
        network: choice.network,
        annualFee: minorToDollarInput(choice.annualFeeMinor),
        nickname: willAutoFill ? choice.officialName : current.nickname,
      };
    });
  }

  const fieldError = (name: string) => state.fieldErrors?.[name] || blurErrors[name];
  const isCardSelected = Boolean(values.contractCardId || values.nickname);

  // Calculate real-time net fee
  const annualFeeNum = parseFloat(values.annualFee) || 0;
  const rebateNum = parseFloat(values.feeRebate) || 0;
  const netFeeNum = Math.max(0, annualFeeNum - rebateNum);

  return (
    <form action={formAction} className="space-y-6">
      {cardId ? <input type="hidden" name="cardId" value={cardId} /> : null}
      <input type="hidden" name="cardJson" value={JSON.stringify(values)} />

      {/* Hidden inputs to guarantee form-binding and test compatibility */}
      <input type="hidden" name="issuer" value={values.issuer} />
      <input type="hidden" name="network" value={values.network} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* ─── Left Column: Form Controls ─────────────────────────── */}
        <div className="lg:col-span-7 space-y-6">
          
          {mode === "create" ? (
            /* ─── Create Mode: Clean, fast card selection ────────── */
            <section className="scroll-mt-20 rounded-2xl border border-border/80 bg-card p-5 sm:p-6 shadow-2xs space-y-5">
              <div>
                <h2 className="text-base font-bold tracking-tight text-foreground">
                  Select Card
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Choose your card from our verified catalogue to unlock real-time reward rates and perk tracking.
                </p>
              </div>

              <CardPicker
                choices={choices}
                value={values.contractCardId}
                onChange={selectCatalogueCard}
              />
              {fieldError("contractCardId") ? (
                <p ref={firstErrorRef} className="mt-1 text-xs font-semibold text-destructive">
                  {fieldError("contractCardId")}
                </p>
              ) : null}

              {/* Nickname (Pre-filled on selection, customizable) */}
              <div className="pt-2 border-t border-border/60">
                <label className={labelBase} htmlFor="nickname">
                  Card Nickname
                  {nicknameAutoFilled && (
                    <span className="ml-1.5 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary animate-in fade-in duration-200">
                      Auto-filled
                    </span>
                  )}
                </label>
                <input
                  id="nickname"
                  name="nickname"
                  className={`${inputBase} ${fieldError("nickname") ? "border-destructive ring-destructive/20" : ""}`}
                  value={values.nickname}
                  onChange={(event) => {
                    set("nickname", event.target.value);
                    if (nicknameAutoFilled) setNicknameAutoFilled(false);
                  }}
                  onBlur={() => handleBlur("nickname")}
                  placeholder="e.g. Cobalt, Main Groceries"
                />
                {fieldError("nickname") ? (
                  <p className="mt-1 text-xs text-destructive">{fieldError("nickname")}</p>
                ) : (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    How this card will be identified throughout your wallet.
                  </p>
                )}
              </div>
            </section>
          ) : (
            /* ─── Edit Mode: Full Card Customization ─────────────── */
            <>
              <section className="scroll-mt-20 rounded-2xl border border-border/80 bg-card p-5 sm:p-6 shadow-2xs space-y-5">
                <div>
                  <h2 className="text-base font-bold tracking-tight text-foreground">
                    Card & Billing Details
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Update your card nickname, fee schedule, and banking rebates.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Nickname */}
                  <div className="sm:col-span-2">
                    <label className={labelBase} htmlFor="nickname">
                      Card Nickname
                    </label>
                    <input
                      id="nickname"
                      name="nickname"
                      className={`${inputBase} ${fieldError("nickname") ? "border-destructive ring-destructive/20" : ""}`}
                      value={values.nickname}
                      onChange={(event) => set("nickname", event.target.value)}
                      onBlur={() => handleBlur("nickname")}
                      placeholder="e.g. Cobalt, Everyday Groceries"
                    />
                    {fieldError("nickname") ? (
                      <p className="mt-1 text-xs text-destructive">{fieldError("nickname")}</p>
                    ) : null}
                  </div>

                  {/* Annual fee */}
                  <div>
                    <label className={labelBase} htmlFor="annualFee">
                      Annual Fee (CAD)
                      {selected && (
                        <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">(verified catalogue)</span>
                      )}
                    </label>
                    <input
                      id="annualFee"
                      name="annualFee"
                      className={`${inputBase} ${selected ? "bg-muted/40 text-foreground font-medium" : ""}`}
                      inputMode="decimal"
                      value={values.annualFee}
                      onChange={(event) => set("annualFee", event.target.value)}
                      readOnly={Boolean(selected)}
                      placeholder="0.00"
                    />
                  </div>

                  {/* Fee rebate */}
                  <div>
                    <label className={labelBase} htmlFor="feeRebate">
                      Bank Fee Rebate (CAD)
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">optional</span>
                    </label>
                    <input
                      id="feeRebate"
                      name="feeRebate"
                      className={`${inputBase} ${fieldError("feeRebate") ? "border-destructive ring-destructive/20" : ""}`}
                      inputMode="decimal"
                      value={values.feeRebate}
                      onChange={(event) => set("feeRebate", event.target.value)}
                      onBlur={() => handleBlur("feeRebate")}
                      placeholder="0.00"
                    />
                    {fieldError("feeRebate") ? (
                      <p className="mt-1 text-xs text-destructive">{fieldError("feeRebate")}</p>
                    ) : (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        If your bank package waives or rebates this fee.
                      </p>
                    )}
                  </div>

                  {/* Fee month-day */}
                  <div>
                    <label className={labelBase} htmlFor="feeMonthDay">
                      Annual Fee Renewal Date
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">optional</span>
                    </label>
                    <input
                      id="feeMonthDay"
                      name="feeMonthDay"
                      className={`${inputBase} ${fieldError("feeMonthDay") ? "border-destructive ring-destructive/20" : ""}`}
                      value={values.feeMonthDay}
                      onChange={(event) => set("feeMonthDay", event.target.value)}
                      onBlur={() => handleBlur("feeMonthDay")}
                      placeholder="e.g. 03-15 (MM-DD)"
                    />
                    {fieldError("feeMonthDay") ? (
                      <p className="mt-1 text-xs text-destructive">{fieldError("feeMonthDay")}</p>
                    ) : (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        MM-DD format for fee renewal alerts.
                      </p>
                    )}
                  </div>

                  {/* Cancellation Grace Days */}
                  <div>
                    <label className={labelBase} htmlFor="feeCancelGraceDays">
                      Grace Period to Cancel (Days)
                    </label>
                    <input
                      id="feeCancelGraceDays"
                      name="feeCancelGraceDays"
                      className={inputBase}
                      inputMode="numeric"
                      value={values.feeCancelGraceDays}
                      onChange={(event) => set("feeCancelGraceDays", event.target.value)}
                      placeholder="30"
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Days after fee posts to cancel without penalty.
                    </p>
                  </div>
                </div>

                {/* ─── Optional Account Details Accordion ───────────────── */}
                <div className="border-t border-border/60 pt-4">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-xs font-semibold text-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors -ml-2 cursor-pointer"
                    onClick={() => setShowOptional((open) => !open)}
                  >
                    <ChevronDown
                      className={`size-3.5 transition-transform duration-200 ${showOptional ? "rotate-180" : ""}`}
                    />
                    <span>
                      {showOptional
                        ? "Hide additional account details"
                        : "Add optional account details (last 4 digits, credit limit, due date)"}
                    </span>
                  </button>

                  {showOptional ? (
                    <div className="grid gap-4 sm:grid-cols-2 mt-4 animate-in fade-in slide-in-from-top-1 duration-200">
                      <div>
                        <label className={labelBase} htmlFor="lastFour">
                          Last Four Digits
                        </label>
                        <input
                          id="lastFour"
                          name="lastFour"
                          className={`${inputBase} ${fieldError("lastFour") ? "border-destructive ring-destructive/20" : ""}`}
                          inputMode="numeric"
                          maxLength={4}
                          value={values.lastFour}
                          onChange={(event) => set("lastFour", event.target.value)}
                          onBlur={() => handleBlur("lastFour")}
                          placeholder="e.g. 1234"
                        />
                        {fieldError("lastFour") ? (
                          <p className="mt-1 text-xs text-destructive">{fieldError("lastFour")}</p>
                        ) : (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Embossed live on your card preview.
                          </p>
                        )}
                      </div>

                      <div>
                        <label className={labelBase} htmlFor="limit">
                          Credit Limit (CAD)
                        </label>
                        <input
                          id="limit"
                          name="limit"
                          className={inputBase}
                          inputMode="decimal"
                          value={values.limit}
                          onChange={(event) => set("limit", event.target.value)}
                          placeholder="e.g. 10000"
                        />
                      </div>

                      <div>
                        <label className={labelBase} htmlFor="statementDay">
                          Statement Closing Day (1–28)
                        </label>
                        <input
                          id="statementDay"
                          name="statementDay"
                          className={inputBase}
                          inputMode="numeric"
                          value={values.statementDay}
                          onChange={(event) => set("statementDay", event.target.value)}
                          placeholder="e.g. 15"
                        />
                      </div>

                      <div>
                        <label className={labelBase} htmlFor="dueDay">
                          Payment Due Day (1–28)
                        </label>
                        <input
                          id="dueDay"
                          name="dueDay"
                          className={inputBase}
                          inputMode="numeric"
                          value={values.dueDay}
                          onChange={(event) => set("dueDay", event.target.value)}
                          placeholder="e.g. 5"
                        />
                      </div>

                      <div>
                        <label className={labelBase} htmlFor="aprPct">
                          Purchase APR (%)
                        </label>
                        <input
                          id="aprPct"
                          name="aprPct"
                          className={inputBase}
                          inputMode="decimal"
                          value={values.aprPct}
                          onChange={(event) => set("aprPct", event.target.value)}
                          placeholder="e.g. 20.99"
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>
            </>
          )}

          {/* Form-level error */}
          {state.error ? (
            <p ref={firstErrorRef} className="text-sm font-semibold text-destructive animate-in fade-in duration-200">
              {state.error}
            </p>
          ) : null}

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              type="submit"
              disabled={isPending || !isCardSelected}
              size="lg"
              className="px-6 font-semibold shadow-xs"
            >
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving card…
                </>
              ) : mode === "create" ? (
                "Add card"
              ) : (
                "Save changes"
              )}
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link href={returnHref}>Cancel</Link>
            </Button>
          </div>
        </div>

        {/* ─── Right Column: Live Card Canvas & Perks HUD ───────────── */}
        <div className="lg:col-span-5 lg:sticky lg:top-8 space-y-4">
          {/* Live Card Visualizer */}
          <div className="rounded-2xl border border-border/80 bg-gradient-to-b from-card/80 to-muted/30 p-5 shadow-xs">
            <div className="flex items-center justify-between mb-3.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Live Card Preview
              </span>
              {isCardSelected && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live Canvas
                </span>
              )}
            </div>

            <div className="flex justify-center">
              {isCardSelected ? (
                <CardImage
                  contractCardId={values.contractCardId}
                  nickname={values.nickname || selected?.officialName}
                  issuer={values.issuer}
                  network={values.network}
                  lastFour={values.lastFour}
                  size="hero"
                  priority
                  className="shadow-md transition-transform duration-300 hover:scale-[1.02]"
                />
              ) : (
                <div className="w-full max-w-[360px] aspect-[1.586/1] rounded-2xl border-2 border-dashed border-border/70 bg-muted/20 flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
                  <CreditCard className="size-8 stroke-[1.2] mb-2 opacity-50" />
                  <p className="text-xs font-semibold text-foreground">No card selected</p>
                  <p className="text-[11px] mt-1 text-muted-foreground/80 max-w-[220px]">
                    Select a card on the left to preview artwork and verified reward rates.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Perks & Rates HUD */}
          {selected && perks ? (
            <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Rewards Program
                  </p>
                  <p className="text-sm font-bold text-foreground">
                    {perks.programName} ({perks.programUnit})
                  </p>
                </div>
                <div className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md">
                  <ShieldCheck className="size-3" />
                  <span>Verified</span>
                </div>
              </div>

              {/* Top Multipliers */}
              {perks.topMultipliers.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">Top Multipliers</span>
                    <span className="text-[10px] text-muted-foreground">Instant Scoring</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {perks.topMultipliers.map((m, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl border border-border/60 bg-muted/20 p-2.5 flex flex-col"
                      >
                        <span className="text-sm font-extrabold text-foreground">{m.earnText}</span>
                        <span className="text-[11px] text-muted-foreground truncate">{m.categoryText}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Key Perks & FX Badges */}
              {(perks.hasZeroFx || perks.credits.length > 0) && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {perks.hasZeroFx && (
                    <span className="inline-flex items-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                      <Sparkles className="size-3 mr-1" />
                      0% Foreign Transaction Fee
                    </span>
                  )}
                  {perks.credits.map((c, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center rounded-lg bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400"
                    >
                      🎁 ${c.valueCad}/{c.period} {c.label}
                    </span>
                  ))}
                </div>
              )}

              {/* Fee Summary */}
              {mode === "edit" ? (
                <div className="rounded-xl border border-border/60 bg-muted/30 p-3 flex items-center justify-between text-xs">
                  <div className="space-y-0.5">
                    <span className="font-medium text-foreground">Effective Net Annual Fee</span>
                    <p className="text-[10px] text-muted-foreground">
                      ${annualFeeNum.toFixed(2)} fee - ${rebateNum.toFixed(2)} rebate
                    </p>
                  </div>
                  <span className="font-bold text-base text-foreground tabular-nums">
                    ${netFeeNum.toFixed(2)}/yr
                  </span>
                </div>
              ) : (
                <div className="rounded-xl border border-border/60 bg-muted/30 p-3 flex items-center justify-between text-xs">
                  <div className="space-y-0.5">
                    <span className="font-medium text-foreground">Published Annual Fee</span>
                    <p className="text-[10px] text-muted-foreground">
                      Verified from card catalogue
                    </p>
                  </div>
                  <span className="font-bold text-sm text-foreground tabular-nums">
                    {annualFeeNum === 0 ? "No Annual Fee" : `$${annualFeeNum.toFixed(2)}/yr`}
                  </span>
                </div>
              )}

              {perks.waiverNote && (
                <p className="text-[11px] text-muted-foreground border-t border-border/50 pt-2.5">
                  <span className="font-medium text-foreground">Bank Fee Waiver: </span>
                  {perks.waiverNote}
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </form>
  );
}

