"use client";

import { useActionState } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { recoverIncompleteCapture, type RecoverCaptureState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export type RecoveryCardOption = {
  id: string;
  label: string;
};

const initialState: RecoverCaptureState = {};

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs font-medium text-destructive">{message}</p> : null;
}

export function RecoveryForm({
  eventId,
  defaults,
  cards,
}: {
  eventId: string;
  defaults: { merchant: string; amount: string; currency: string; cardId: string };
  cards: RecoveryCardOption[];
}) {
  const [state, formAction, pending] = useActionState(recoverIncompleteCapture, initialState);

  return (
    <form action={formAction} className="space-y-4" aria-label="Correct capture">
      <input type="hidden" name="eventId" value={eventId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`merchant-${eventId}`} className="text-xs font-semibold text-foreground">
            Merchant
          </label>
          <Input
            id={`merchant-${eventId}`}
            name="merchant"
            defaultValue={defaults.merchant}
            placeholder="Merchant name"
            autoComplete="organization"
            maxLength={180}
            required
            aria-invalid={Boolean(state.fieldErrors?.merchant)}
          />
          <FieldError message={state.fieldErrors?.merchant} />
        </div>

        <div>
          <label htmlFor={`amount-${eventId}`} className="text-xs font-semibold text-foreground">
            Amount
          </label>
          <Input
            id={`amount-${eventId}`}
            name="amount"
            type="text"
            inputMode="decimal"
            defaultValue={defaults.amount}
            placeholder="0.00"
            pattern="\d{1,11}(\.\d{1,4})?"
            required
            aria-invalid={Boolean(state.fieldErrors?.amount)}
          />
          <FieldError message={state.fieldErrors?.amount} />
        </div>

        <div>
          <label htmlFor={`currency-${eventId}`} className="text-xs font-semibold text-foreground">
            Currency
          </label>
          <Input
            id={`currency-${eventId}`}
            name="currency"
            defaultValue={defaults.currency}
            placeholder="CAD"
            list={`recovery-currencies-${eventId}`}
            minLength={3}
            maxLength={3}
            pattern="[A-Za-z]{3}"
            autoCapitalize="characters"
            required
            aria-describedby={`currency-note-${eventId}`}
            aria-invalid={Boolean(state.fieldErrors?.currency)}
          />
          <p id={`currency-note-${eventId}`} className="mt-1 text-[11px] text-muted-foreground">
            Required. Currency is never inferred from the card or location.
          </p>
          <FieldError message={state.fieldErrors?.currency} />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={`card-${eventId}`} className="text-xs font-semibold text-foreground">
            Saved card <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Select
            id={`card-${eventId}`}
            name="cardId"
            defaultValue={defaults.cardId}
            aria-invalid={Boolean(state.fieldErrors?.cardId)}
          >
            <option value="">Leave card unmapped</option>
            {cards.map((card) => (
              <option key={card.id} value={card.id}>{card.label}</option>
            ))}
          </Select>
          <p className="mt-1 text-[11px] text-muted-foreground">
            A choice also teaches the existing Wallet card alias when a label was captured.
          </p>
          <FieldError message={state.fieldErrors?.cardId} />
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div aria-live="polite" className="min-h-5 text-xs">
          {state.message ? (
            <span className={state.ok ? "inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400" : "inline-flex items-center gap-1.5 text-destructive"}>
              {state.ok ? <Check className="size-3.5" /> : <AlertCircle className="size-3.5" />}
              {state.message}
            </span>
          ) : null}
        </div>
        <Button type="submit" disabled={pending} className="sm:min-w-36">
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? "Recovering…" : "Create purchase"}
        </Button>
      </div>

      <datalist id={`recovery-currencies-${eventId}`}>
        <option value="CAD" />
        <option value="USD" />
        <option value="JMD" />
        <option value="EUR" />
        <option value="GBP" />
      </datalist>
    </form>
  );
}
