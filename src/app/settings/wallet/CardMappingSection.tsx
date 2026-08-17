"use client";

import { useState, useTransition } from "react";
import { mapWalletCard } from "./actions";

type UnmappedString = { rawString: string; tapCount: number };
type OwnedCard = { nickname: string; contractCardId: string };

export default function CardMappingSection({
  unmapped,
  cards,
}: {
  unmapped: UnmappedString[];
  cards: OwnedCard[];
}) {
  const [pending, startTransition] = useTransition();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  if (unmapped.length === 0) return null;

  return (
    <div className="mt-8 rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Map your cards</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Apple reports each card as a text label. Tell us which of your cards each label means —
        recommendations start working the moment a card is mapped.
      </p>
      {error ? <div className="mt-2 text-xs text-red-600">{error}</div> : null}
      <div className="mt-3 space-y-2">
        {unmapped.map(({ rawString, tapCount }) => (
          <div key={rawString} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
            <div>
              <div className="text-sm text-slate-900">“{rawString}”</div>
              <div className="text-xs text-slate-500">{tapCount} capture{tapCount === 1 ? "" : "s"}</div>
            </div>
            <div className="flex items-center gap-2">
              <select
                className="rounded-lg border px-2 py-1.5 text-sm"
                value={choices[rawString] ?? ""}
                onChange={(e) => setChoices((c) => ({ ...c, [rawString]: e.target.value }))}
              >
                <option value="">Choose a card…</option>
                {cards.map((card) => (
                  <option key={card.contractCardId} value={card.contractCardId}>
                    {card.nickname}
                  </option>
                ))}
              </select>
              <button
                className="rounded-full border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
                disabled={pending || !choices[rawString]}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const result = await mapWalletCard({
                      rawString,
                      contractCardId: choices[rawString],
                    });
                    if (!result.ok) setError(result.error);
                  });
                }}
              >
                Save
              </button>
            </div>
          </div>
        ))}
      </div>
      {cards.length === 0 ? (
        <p className="mt-3 text-xs text-amber-700">
          Add your cards first under <a className="underline" href="/cards/new">Cards</a>.
        </p>
      ) : null}
    </div>
  );
}
