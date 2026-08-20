"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestCard, type CardRequestState } from "./actions";

const input =
  "mt-1 flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring";
const label = "block text-xs font-medium text-foreground";

export function CardRequestForm() {
  const [state, formAction, isPending] = useActionState<CardRequestState, FormData>(requestCard, {});

  if (state.ok) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Request received</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We&apos;ll add it once its terms are confirmed against the issuer. Until then, the rest of
          your wallet works as normal.
        </p>
        <Link
          href="/cards/new"
          className="mt-3 inline-block text-sm underline underline-offset-2"
        >
          Back to Add card
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <label className={label} htmlFor="issuer">
          Issuer
        </label>
        <input id="issuer" name="issuer" className={input} placeholder="Scotiabank" />
      </div>
      <div>
        <label className={label} htmlFor="cardName">
          Card name
        </label>
        <input id="cardName" name="cardName" className={input} placeholder="Scotia Platinum Amex" />
      </div>
      <div>
        <label className={label} htmlFor="note">
          Anything else? (optional)
        </label>
        <textarea id="note" name="note" rows={3} className={`${input} h-auto`} />
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {isPending ? "Sending…" : "Send request"}
      </button>
    </form>
  );
}
