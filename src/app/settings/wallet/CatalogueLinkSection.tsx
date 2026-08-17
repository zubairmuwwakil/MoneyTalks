"use client";

import { useState, useTransition } from "react";
import { linkSavedCardToContract } from "./actions";

type SavedCard = { id: string; nickname: string; issuer: string; network: string; contractCardId: string | null };
type ContractCard = { id: string; label: string; issuer: string };

export default function CatalogueLinkSection({ cards, contracts }: { cards: SavedCard[]; contracts: ContractCard[] }) {
  const [pending, startTransition] = useTransition();
  const [choices, setChoices] = useState<Record<string, string>>(
    Object.fromEntries(cards.map((card) => [card.id, card.contractCardId ?? ""])),
  );
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Link saved cards to catalogue rules</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Confirm the exact PickMe product for each card. This only links your saved card to its published reward rules; it does not connect to your bank or change your wallet setup.
      </p>
      {error ? <p role="alert" className="mt-3 text-xs text-red-600">{error}</p> : null}
      {cards.length === 0 ? (
        <p className="mt-3 text-xs text-amber-700">Add a card under <a className="underline" href="/cards/new">Cards</a> first.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {cards.map((card) => (
            <div key={card.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-900">{card.nickname}</p>
                <p className="text-xs text-slate-500">{card.issuer} · {card.network}</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  className="max-w-64 rounded-lg border px-2 py-1.5 text-sm"
                  value={choices[card.id] ?? ""}
                  onChange={(event) => { setChoices((current) => ({ ...current, [card.id]: event.target.value })); setSaved((current) => ({ ...current, [card.id]: false })); }}
                >
                  <option value="">Choose exact catalogue card…</option>
                  {contracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.label} · {contract.issuer}</option>)}
                </select>
                <button
                  className="rounded-full border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
                  disabled={pending || saved[card.id] || !choices[card.id] || choices[card.id] === card.contractCardId}
                  onClick={() => {
                    setError(null);
                    startTransition(async () => {
                      const result = await linkSavedCardToContract({ cardId: card.id, contractCardId: choices[card.id] });
                      if (!result.ok) { setError(result.error); return; }
                      setSaved((current) => ({ ...current, [card.id]: true }));
                    });
                  }}
                >
                  {saved[card.id] ? "Linked" : card.contractCardId ? "Update" : "Link"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
