"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { createCard, updateCard, type CardFormState } from "@/app/cards/actions";
import type { CatalogueChoice } from "@/lib/cards/catalogueCard";
import { minorToDollarInput } from "@/engine/money";
import type { Network } from "@/lib/cards/types";
import { CardImage } from "@/components/cards/card-image";

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

const input =
  "mt-1 flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50";
const label = "block text-xs font-medium text-foreground";
const initialCardFormState: CardFormState = {};

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

  const byIssuer = useMemo(() => {
    const groups = new Map<string, CatalogueChoice[]>();
    for (const choice of choices) {
      const bucket = groups.get(choice.issuer);
      if (bucket) bucket.push(choice);
      else groups.set(choice.issuer, [choice]);
    }
    return [...groups.entries()];
  }, [choices]);

  const selected = choices.find((c) => c.contractCardId === values.contractCardId) ?? null;
  const returnHref = mode === "edit" && cardId ? `/cards/${cardId}` : "/cards/manage";

  function set<K extends keyof CardFormValues>(key: K, value: CardFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  // Picking a card fills in its identity and published fee. Deliberately
  // nothing rate-shaped is copied onto the row: copying rates is exactly how
  // the hub ended up with a second rate model that drifted from the catalogue.
  function selectCatalogueCard(contractCardId: string) {
    const choice = choices.find((c) => c.contractCardId === contractCardId);
    if (!choice) {
      set("contractCardId", "");
      return;
    }
    setValues((current) => ({
      ...current,
      contractCardId: choice.contractCardId,
      issuer: choice.issuer,
      network: choice.network,
      annualFee: minorToDollarInput(choice.annualFeeMinor),
      // Only suggest a nickname while the user has not written their own.
      nickname: current.nickname.trim() === "" ? choice.officialName : current.nickname,
    }));
  }

  const fieldError = (name: string) => state.fieldErrors?.[name];

  return (
    <form action={formAction} className="space-y-6">
      {cardId ? <input type="hidden" name="cardId" value={cardId} /> : null}
      <input type="hidden" name="cardJson" value={JSON.stringify(values)} />

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold">Which card is this?</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Rates, caps and credits come from the shared card catalogue, so this card scores the same
          here as it does in PickMe. They are not editable by hand.
        </p>

        <label className={`${label} mt-4`} htmlFor="contractCardId">
          Card
        </label>
        <select
          id="contractCardId"
          className={input}
          value={values.contractCardId}
          onChange={(event) => selectCatalogueCard(event.target.value)}
        >
          <option value="">Select a card…</option>
          {byIssuer.map(([issuer, group]) => (
            <optgroup key={issuer} label={issuer}>
              {group.map((choice) => (
                <option key={choice.contractCardId} value={choice.contractCardId}>
                  {choice.officialName}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {fieldError("contractCardId") ? (
          <p className="mt-1 text-xs text-destructive">{fieldError("contractCardId")}</p>
        ) : null}

        {selected ? (
          <div className="mt-4 rounded-xl border border-border/80 bg-muted/20 p-4 sm:p-5 flex flex-col sm:flex-row items-center sm:items-start gap-4">
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
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            Can&apos;t find your card?{" "}
            <Link href="/cards/request" className="underline underline-offset-2">
              Request it
            </Link>{" "}
            — cards are added once their terms are confirmed against the issuer.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-4">
        <h2 className="text-sm font-semibold">Your copy of it</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="nickname">
              Nickname
            </label>
            <input
              id="nickname"
              className={input}
              value={values.nickname}
              onChange={(event) => set("nickname", event.target.value)}
              placeholder="Everyday card"
            />
            {fieldError("nickname") ? (
              <p className="mt-1 text-xs text-destructive">{fieldError("nickname")}</p>
            ) : null}
          </div>

          <div>
            <label className={label} htmlFor="annualFee">
              Annual fee (CAD)
            </label>
            <input
              id="annualFee"
              className={input}
              inputMode="decimal"
              value={values.annualFee}
              onChange={(event) => set("annualFee", event.target.value)}
            />
          </div>

          <div>
            <label className={label} htmlFor="feeRebate">
              Fee rebate you receive (CAD)
            </label>
            <input
              id="feeRebate"
              className={input}
              inputMode="decimal"
              value={values.feeRebate}
              onChange={(event) => set("feeRebate", event.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Issuers rebate different amounts depending on the banking package you hold, so this is
              yours to state — we never assume one.
            </p>
            {fieldError("feeRebate") ? (
              <p className="mt-1 text-xs text-destructive">{fieldError("feeRebate")}</p>
            ) : null}
          </div>

          <div>
            <label className={label} htmlFor="feeMonthDay">
              Fee posts on (MM-DD)
            </label>
            <input
              id="feeMonthDay"
              className={input}
              value={values.feeMonthDay}
              onChange={(event) => set("feeMonthDay", event.target.value)}
              placeholder="03-15"
            />
            {fieldError("feeMonthDay") ? (
              <p className="mt-1 text-xs text-destructive">{fieldError("feeMonthDay")}</p>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          className="text-xs font-medium underline underline-offset-2 text-muted-foreground"
          onClick={() => setShowOptional((open) => !open)}
        >
          {showOptional ? "Hide" : "Show"} account details
        </button>

        {showOptional ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="lastFour">
                Last four
              </label>
              <input
                id="lastFour"
                className={input}
                inputMode="numeric"
                maxLength={4}
                value={values.lastFour}
                onChange={(event) => set("lastFour", event.target.value)}
              />
              {fieldError("lastFour") ? (
                <p className="mt-1 text-xs text-destructive">{fieldError("lastFour")}</p>
              ) : null}
            </div>
            <div>
              <label className={label} htmlFor="limit">
                Credit limit (CAD)
              </label>
              <input
                id="limit"
                className={input}
                inputMode="decimal"
                value={values.limit}
                onChange={(event) => set("limit", event.target.value)}
              />
            </div>
            <div>
              <label className={label} htmlFor="statementDay">
                Statement day
              </label>
              <input
                id="statementDay"
                className={input}
                inputMode="numeric"
                value={values.statementDay}
                onChange={(event) => set("statementDay", event.target.value)}
              />
            </div>
            <div>
              <label className={label} htmlFor="dueDay">
                Payment due day
              </label>
              <input
                id="dueDay"
                className={input}
                inputMode="numeric"
                value={values.dueDay}
                onChange={(event) => set("dueDay", event.target.value)}
              />
            </div>
            <div>
              <label className={label} htmlFor="aprPct">
                APR (%)
              </label>
              <input
                id="aprPct"
                className={input}
                inputMode="decimal"
                value={values.aprPct}
                onChange={(event) => set("aprPct", event.target.value)}
              />
            </div>
            <div>
              <label className={label} htmlFor="feeCancelGraceDays">
                Days to cancel after the fee posts
              </label>
              <input
                id="feeCancelGraceDays"
                className={input}
                inputMode="numeric"
                value={values.feeCancelGraceDays}
                onChange={(event) => set("feeCancelGraceDays", event.target.value)}
              />
            </div>
          </div>
        ) : null}
      </section>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {isPending ? "Saving…" : mode === "create" ? "Add card" : "Save changes"}
        </button>
        <Link href={returnHref} className="text-sm text-muted-foreground underline underline-offset-2">
          Cancel
        </Link>
      </div>
    </form>
  );
}
