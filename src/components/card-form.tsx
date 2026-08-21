"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createCard, updateCard, type CardFormState } from "@/app/cards/actions";
import type { CatalogueChoice } from "@/lib/cards/catalogueCard";
import { minorToDollarInput } from "@/engine/money";
import type { Network } from "@/lib/cards/types";
import { CardImage } from "@/components/cards/card-image";
import { CardPicker } from "@/components/cards/card-picker";
import { Button } from "@/components/ui/button";

/**
 * What the hub lets you edit about a card: YOUR copy of it.
 *
 * Rates, caps, FX and credits are NOT here and cannot be typed in. They are
 * resolved from PickMe's catalogue through `contractCardId` — issuer-sourced,
 * versioned, and identical to what the phone scores with. The 1,460-line rate
 * editor this file replaced let any user author their own earn rules, which
 * decision D3 rules out ("No open card editor (quality moat)") and which had
 * produced a second, weaker, unsourced rate model for the same 27 cards.
 *
 * A card that is not in the catalogue is not editable into existence here
 * either: it routes to the card-request flow, which is D3's demand-driven
 * expansion path.
 */
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
  "mt-1 flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50";
const labelBase = "block text-xs font-medium text-foreground";
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
  const returnHref = mode === "edit" && cardId ? `/cards/${cardId}` : "/cards/manage";

  // ── Toast on server error ────────────────────────────────────────────
  useEffect(() => {
    if (state.error) {
      toast.error(state.error);
      // Scroll first error into view
      setTimeout(() => firstErrorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    }
  }, [state.error]);

  function set<K extends keyof CardFormValues>(key: K, value: CardFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    // Clear blur error when user edits a field
    if (blurErrors[key]) {
      setBlurErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  }

  function handleBlur(name: string) {
    const error = validateField(name, (values as Record<string, string>)[name] ?? "", values);
    setBlurErrors((prev) => ({ ...prev, [name]: error }));
  }

  // Picking a card fills in its identity and published fee. Deliberately
  // nothing rate-shaped is copied onto the row: copying rates is exactly how
  // the hub ended up with a second rate model that drifted from the catalogue.
  function selectCatalogueCard(contractCardId: string) {
    const choice = choices.find((c) => c.contractCardId === contractCardId);
    if (!choice) {
      set("contractCardId", "");
      setNicknameAutoFilled(false);
      return;
    }
    setValues((current) => {
      const willAutoFill = current.nickname.trim() === "";
      if (willAutoFill) setNicknameAutoFilled(true);
      return {
        ...current,
        contractCardId: choice.contractCardId,
        issuer: choice.issuer,
        network: choice.network,
        annualFee: minorToDollarInput(choice.annualFeeMinor),
        // Only suggest a nickname while the user has not written their own.
        nickname: willAutoFill ? choice.officialName : current.nickname,
      };
    });
  }

  const fieldError = (name: string) => state.fieldErrors?.[name] || blurErrors[name];
  const isCardSelected = Boolean(values.contractCardId);

  return (
    <form action={formAction} className="space-y-6">
      {cardId ? <input type="hidden" name="cardId" value={cardId} /> : null}
      <input type="hidden" name="cardJson" value={JSON.stringify(values)} />

      {/* ─── Section 1: Card selection ─────────────────────────────── */}
      <section className="scroll-mt-20 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold">Which card is this?</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Rates, caps and credits come from the shared card catalogue, so this card scores the same
          here as it does in PickMe. They are not editable by hand.
        </p>

        <label className={`${labelBase} mt-4`} htmlFor="contractCardId">
          Card
        </label>
        <div className="mt-1">
          <CardPicker
            choices={choices}
            value={values.contractCardId}
            onChange={selectCatalogueCard}
          />
        </div>
        {fieldError("contractCardId") ? (
          <p ref={firstErrorRef} className="mt-1 text-xs text-destructive">
            {fieldError("contractCardId")}
          </p>
        ) : null}

        {selected ? (
          <div className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300 rounded-xl border border-border/80 bg-muted/20 p-4 sm:p-5 flex flex-col sm:flex-row items-center sm:items-start gap-4">
            <CardImage
              contractCardId={values.contractCardId}
              nickname={values.nickname || selected.officialName}
              issuer={values.issuer}
              network={values.network}
              lastFour={values.lastFour}
              size="preview"
              priority
            />
            <div className="flex-1 space-y-2 text-center sm:text-left">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-1.5">
                <span className="text-xs font-bold text-foreground">{selected.officialName}</span>
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {values.network}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Official card identity from verified catalogue. Published annual fee:{" "}
                <span className="font-semibold text-foreground">${values.annualFee}/yr</span>
              </p>
              <div className="pt-1 flex flex-wrap justify-center sm:justify-start gap-1.5">
                <span className="inline-flex items-center rounded-md bg-background px-2 py-0.5 text-[11px] font-medium text-foreground border border-border/70 shadow-2xs">
                  ✓ Verified Rewards
                </span>
                <span className="inline-flex items-center rounded-md bg-background px-2 py-0.5 text-[11px] font-medium text-foreground border border-border/70 shadow-2xs">
                  ✓ Instant Scoring
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* ─── Section 2: Your copy ──────────────────────────────────── */}
      <section className="scroll-mt-20 rounded-xl border border-border bg-card p-4 sm:p-5 space-y-4">
        <h2 className="text-sm font-semibold">Your copy of it</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Nickname */}
          <div>
            <label className={labelBase} htmlFor="nickname">
              Nickname
              {nicknameAutoFilled && (
                <span className="ml-1.5 inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary animate-in fade-in duration-200">
                  auto-filled
                </span>
              )}
            </label>
            <input
              id="nickname"
              className={`${inputBase} ${fieldError("nickname") ? "border-destructive ring-destructive/20" : ""}`}
              value={values.nickname}
              onChange={(event) => {
                set("nickname", event.target.value);
                if (nicknameAutoFilled) setNicknameAutoFilled(false);
              }}
              onBlur={() => handleBlur("nickname")}
              placeholder="e.g. Everyday card, Groceries card"
            />
            {fieldError("nickname") ? (
              <p className="mt-1 text-xs text-destructive">{fieldError("nickname")}</p>
            ) : null}
          </div>

          {/* Annual fee */}
          <div>
            <label className={labelBase} htmlFor="annualFee">
              Annual fee (CAD)
              {selected && (
                <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">(from catalogue)</span>
              )}
            </label>
            <input
              id="annualFee"
              className={`${inputBase} ${selected ? "bg-muted/50 text-muted-foreground" : ""}`}
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
              Fee rebate you receive (CAD)
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">optional</span>
            </label>
            <input
              id="feeRebate"
              className={`${inputBase} ${fieldError("feeRebate") ? "border-destructive ring-destructive/20" : ""}`}
              inputMode="decimal"
              value={values.feeRebate}
              onChange={(event) => set("feeRebate", event.target.value)}
              onBlur={() => handleBlur("feeRebate")}
              placeholder="0.00"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Issuers rebate different amounts depending on the banking package you hold, so this is
              yours to state — we never assume one.
            </p>
            {fieldError("feeRebate") ? (
              <p className="mt-1 text-xs text-destructive">{fieldError("feeRebate")}</p>
            ) : null}
          </div>

          {/* Fee month-day */}
          <div>
            <label className={labelBase} htmlFor="feeMonthDay">
              Fee posts on
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">optional</span>
            </label>
            <input
              id="feeMonthDay"
              className={`${inputBase} ${fieldError("feeMonthDay") ? "border-destructive ring-destructive/20" : ""}`}
              value={values.feeMonthDay}
              onChange={(event) => set("feeMonthDay", event.target.value)}
              onBlur={() => handleBlur("feeMonthDay")}
              placeholder="e.g. 03-15 (March 15th)"
            />
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              MM-DD format — the date your annual fee posts each year
            </p>
            {fieldError("feeMonthDay") ? (
              <p className="mt-1 text-xs text-destructive">{fieldError("feeMonthDay")}</p>
            ) : null}
          </div>
        </div>

        {/* ─── Optional account details toggle ──────────────────────── */}
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors -ml-2.5"
          onClick={() => setShowOptional((open) => !open)}
        >
          <ChevronDown
            className={`size-3.5 transition-transform duration-200 ${showOptional ? "rotate-180" : ""}`}
          />
          {showOptional ? "Hide" : "Show"} account details
        </button>

        {showOptional ? (
          <div className="grid gap-4 sm:grid-cols-2 animate-in fade-in slide-in-from-top-1 duration-200">
            <div>
              <label className={labelBase} htmlFor="lastFour">
                Last four digits
              </label>
              <input
                id="lastFour"
                className={`${inputBase} ${fieldError("lastFour") ? "border-destructive ring-destructive/20" : ""}`}
                inputMode="numeric"
                maxLength={4}
                value={values.lastFour}
                onChange={(event) => set("lastFour", event.target.value)}
                onBlur={() => handleBlur("lastFour")}
                placeholder="1234"
              />
              {fieldError("lastFour") ? (
                <p className="mt-1 text-xs text-destructive">{fieldError("lastFour")}</p>
              ) : null}
            </div>
            <div>
              <label className={labelBase} htmlFor="limit">
                Credit limit (CAD)
              </label>
              <input
                id="limit"
                className={inputBase}
                inputMode="decimal"
                value={values.limit}
                onChange={(event) => set("limit", event.target.value)}
                placeholder="e.g. 10000"
              />
            </div>
            <div>
              <label className={labelBase} htmlFor="statementDay">
                Statement day
              </label>
              <input
                id="statementDay"
                className={inputBase}
                inputMode="numeric"
                value={values.statementDay}
                onChange={(event) => set("statementDay", event.target.value)}
                placeholder="e.g. 15"
              />
            </div>
            <div>
              <label className={labelBase} htmlFor="dueDay">
                Payment due day
              </label>
              <input
                id="dueDay"
                className={inputBase}
                inputMode="numeric"
                value={values.dueDay}
                onChange={(event) => set("dueDay", event.target.value)}
                placeholder="e.g. 5"
              />
            </div>
            <div>
              <label className={labelBase} htmlFor="aprPct">
                APR (%)
              </label>
              <input
                id="aprPct"
                className={inputBase}
                inputMode="decimal"
                value={values.aprPct}
                onChange={(event) => set("aprPct", event.target.value)}
                placeholder="e.g. 20.99"
              />
            </div>
            <div>
              <label className={labelBase} htmlFor="feeCancelGraceDays">
                Days to cancel after fee posts
              </label>
              <input
                id="feeCancelGraceDays"
                className={inputBase}
                inputMode="numeric"
                value={values.feeCancelGraceDays}
                onChange={(event) => set("feeCancelGraceDays", event.target.value)}
                placeholder="30"
              />
            </div>
          </div>
        ) : null}
      </section>

      {/* ─── Form-level error ─────────────────────────────────────── */}
      {state.error ? (
        <p ref={firstErrorRef} className="text-sm font-medium text-destructive animate-in fade-in duration-200">
          {state.error}
        </p>
      ) : null}

      {/* ─── Actions ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Button
          type="submit"
          disabled={isPending || !isCardSelected}
          size="default"
        >
          {isPending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Saving…
            </>
          ) : mode === "create" ? (
            "Add card"
          ) : (
            "Save changes"
          )}
        </Button>
        <Button variant="outline" asChild>
          <Link href={returnHref}>Cancel</Link>
        </Button>
      </div>

      {/* Hint when button is disabled because no card selected */}
      {!isCardSelected && !isPending && (
        <p className="text-xs text-muted-foreground animate-in fade-in duration-300">
          Select a card from the catalogue above to continue.
        </p>
      )}
    </form>
  );
}
