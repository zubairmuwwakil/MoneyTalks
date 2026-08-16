"use client";

import { useMemo, useState } from "react";
import { matchMerchant, type MerchantFact } from "@/engine/cards/merchants";
import { recommend, type PurchaseCtx } from "@/engine/cards/picker";
import {
  CATEGORY_LABELS,
  SPEND_CATEGORIES,
  type CapUsage,
  type CardDef,
  type SpendCategory,
} from "@/engine/cards/types";

export function CardPicker({ cards, capUsage, today }: { cards: CardDef[]; capUsage: CapUsage[]; today: string }) {
  const [category, setCategory] = useState<SpendCategory | null>(null);
  const [amexAccepted, setAmexAccepted] = useState(true);
  const [foreign, setForeign] = useState(false);
  const [merchant, setMerchant] = useState<MerchantFact | null>(null);
  const [personalMerchantName, setPersonalMerchantName] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const matches = useMemo(() => matchMerchant(query).slice(0, 5), [query]);
  const personalMerchantMatches = useMemo(() => {
    const uniqueNames = [
      ...new Set(
        cards.flatMap((card) =>
          card.rewards.merchantRates?.flatMap((rate) => rate.merchant.split(",").map((name) => name.trim()).filter(Boolean)) ?? [],
        ),
      ),
    ];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return [];
    return uniqueNames.filter((name) => name.toLocaleLowerCase().includes(normalizedQuery)).slice(0, 5);
  }, [cards, query]);
  const effectiveCategory = merchant?.category ?? category ?? (personalMerchantName ? "everything_else" : null);
  const ctx: PurchaseCtx | null = effectiveCategory
    ? {
        category: effectiveCategory,
        amexAccepted: merchant?.amexAccepted === false ? false : amexAccepted,
        foreign: effectiveCategory === "online_foreign" ? true : foreign,
        networkRestriction: merchant?.networkRestriction ?? null,
        today,
        merchantName: merchant?.name ?? personalMerchantName,
      }
    : null;
  const answer = ctx ? recommend(cards, ctx, capUsage) : null;

  return (
    <div className="space-y-4">
      <div>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setMerchant(null);
            setPersonalMerchantName(null);
          }}
          placeholder="Merchant search (e.g. Costco)"
          className="w-full rounded border px-3 py-2 text-sm"
        />
        {(matches.length > 0 || personalMerchantMatches.length > 0) && !merchant && !personalMerchantName ? (
          <ul className="mt-1 rounded border text-sm">
            {matches.map((m) => (
              <li key={m.name}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left hover:bg-muted/50"
                  onClick={() => {
                    setMerchant(m);
                    setPersonalMerchantName(null);
                    setQuery(m.name);
                  }}
                >
                  <span>{m.name}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {CATEGORY_LABELS[m.category]}
                    {m.note ? ` - ${m.note}` : ""}
                  </span>
                </button>
              </li>
            ))}
            {personalMerchantMatches.map((name) => (
              <li key={`personal-${name}`}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left hover:bg-muted/50"
                  onClick={() => {
                    setMerchant(null);
                    setPersonalMerchantName(name);
                    setQuery(name);
                  }}
                >
                  <span>{name}</span> <span className="text-xs text-muted-foreground">your merchant bonus</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {SPEND_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              setCategory(c);
              setMerchant(null);
              setPersonalMerchantName(null);
              setQuery("");
            }}
            className={`min-h-12 rounded border px-3 py-3 text-sm ${
              effectiveCategory === c ? "bg-foreground text-background" : "hover:bg-muted/50"
            }`}
          >
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={amexAccepted} onChange={(e) => setAmexAccepted(e.target.checked)} />
          Amex accepted here
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={foreign} onChange={(e) => setForeign(e.target.checked)} />
          Foreign currency
        </label>
      </div>

      {answer ? (
        <div className="rounded border p-4" data-testid="picker-answer">
          {answer.best ? (
            <>
              <p className="text-lg font-semibold">{answer.best.nickname}</p>
              <p className="text-sm text-muted-foreground">
                {answer.best.pct.toFixed(1)}% - {answer.best.why}
              </p>
              {answer.runnerUp ? (
                <p className="mt-2 text-sm">
                  Runner-up: {answer.runnerUp.nickname} ({answer.runnerUp.pct.toFixed(1)}%)
                </p>
              ) : null}
              {merchant?.note ? (
                <p className="mt-2 text-xs text-muted-foreground">{merchant.note} - verify at the till.</p>
              ) : null}
            </>
          ) : (
            <p className="text-sm">No usable card for this context.</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Pick a category or merchant.</p>
      )}
    </div>
  );
}
