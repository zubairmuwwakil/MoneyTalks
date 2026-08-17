"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Check, FileSpreadsheet, Plus, Upload, X } from "lucide-react";
import { formatMinorUnits } from "@/engine/money";
import {
  addStatementLineAsPurchase,
  previewStatement,
  resolveTolerantMatch,
  type StatementPreview,
  type StatementReviewLine,
} from "./actions";

type CardOption = { id: string; nickname: string; currency: "CAD" | "USD" | "JMD"; contractCardId: string | null };
type ContractCardOption = { id: string; label: string };

const input =
  "mt-1 flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm shadow-2xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const action =
  "inline-flex h-7 items-center gap-1 rounded-md border border-border/80 bg-background px-2 text-[11px] font-semibold hover:bg-muted disabled:opacity-50";

const STATUS_LABEL: Record<string, string> = {
  matched: "Matched",
  "matched-tolerant": "Tip tolerance",
  ambiguous: "Ambiguous",
  unmatched: "Unmatched",
  rejected: "Not a match",
};

export function StatementReconciliationForm({ cards, contractCards }: { cards: CardOption[]; contractCards: ContractCardOption[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [cardId, setCardId] = useState(cards[0]?.id ?? "");
  const selectedCard = useMemo(() => cards.find((card) => card.id === cardId), [cards, cardId]);
  const currency = selectedCard?.currency ?? "CAD";
  const [contractCardId, setContractCardId] = useState(selectedCard?.contractCardId ?? "");
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Outcome of the action taken on a review line, so a settled row stops offering it.
  const [settled, setSettled] = useState<Record<string, "added" | "matched" | "rejected">>({});

  function selectCard(nextCardId: string) {
    setCardId(nextCardId);
    setContractCardId(cards.find((card) => card.id === nextCardId)?.contractCardId ?? "");
    setPreview(null);
    setSettled({});
  }

  function reconcile() {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a CSV file first.");
      return;
    }
    setError(null);
    setPreview(null);
    setSettled({});
    startTransition(async () => {
      const result = await previewStatement(data);
      if (!result.ok) setError(result.error);
      else setPreview(result);
    });
  }

  function runOnLine(line: StatementReviewLine, perform: () => Promise<{ ok: boolean; error?: string }>, outcome: "added" | "matched" | "rejected") {
    if (!selectedCard) return;
    setPendingId(line.id);
    startTransition(async () => {
      const result = await perform();
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      else setSettled((current) => ({ ...current, [line.id]: outcome }));
      setPendingId(null);
    });
  }

  function addLine(line: StatementReviewLine) {
    const card = selectedCard;
    if (!card) return;
    runOnLine(line, () => addStatementLineAsPurchase({
      cardId: card.id, date: line.date, amountMinor: line.amountMinor, description: line.description,
    }), "added");
  }

  function decideLine(line: StatementReviewLine, decision: "confirm" | "reject") {
    const card = selectedCard;
    if (!card) return;
    runOnLine(line, () => resolveTolerantMatch({
      cardId: card.id, date: line.date, amountMinor: line.amountMinor, description: line.description, decision,
    }), decision === "confirm" ? "matched" : "rejected");
  }

  return (
    <div className="space-y-6">
      <form ref={formRef} action={reconcile} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs font-medium text-foreground">
            Card
            <select name="cardId" value={cardId} onChange={(event) => selectCard(event.target.value)} className={input}>
              {cards.map((card) => <option key={card.id} value={card.id}>{card.nickname}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium text-foreground">
            Wallet capture identity
            <select name="contractCardId" value={contractCardId} onChange={(event) => setContractCardId(event.target.value)} className={input} required>
              <option value="" disabled>Choose the card used by Wallet capture</option>
              {contractCards.map((card) => <option key={card.id} value={card.id}>{card.label}</option>)}
            </select>
            <span className="mt-1 block text-[11px] font-normal text-muted-foreground">Saved to this card after reconciliation so future captures are scoped correctly.</span>
          </label>
        </div>

        <div>
          <label className="text-xs font-medium text-foreground">Statement CSV</label>
          <input name="file" type="file" accept=".csv,text/csv" className={`${input} cursor-pointer`} />
          <p className="mt-1 text-[11px] text-muted-foreground">Parsed in memory only. The CSV and its rows are never saved.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-medium text-foreground">Date column (0-based)<input name="dateCol" type="number" min="0" defaultValue="0" className={input} /></label>
          <label className="text-xs font-medium text-foreground">Amount column (0-based)<input name="amountCol" type="number" min="0" defaultValue="2" className={input} /></label>
          <label className="text-xs font-medium text-foreground">Description column (0-based)<input name="descriptionCol" type="number" min="0" defaultValue="1" className={input} /></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-foreground">Date format
            <select name="dateFormat" defaultValue="YMD" className={input}><option value="YMD">YYYY-MM-DD</option><option value="MDY">MM/DD/YYYY</option><option value="DMY">DD/MM/YYYY</option></select>
          </label>
          <div className="flex items-end pb-1">
            <div className="space-y-2 rounded-lg border border-border/80 bg-muted/20 p-3 text-xs">
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" name="hasHeader" value="true" defaultChecked /> First row is a header</label>
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" name="negate" value="true" /> Flip signs (if purchases are negative)</label>
            </div>
          </div>
        </div>
        <button type="submit" disabled={isPending || !selectedCard || !contractCardId} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-4 text-xs font-semibold text-background shadow-xs hover:bg-foreground/90 disabled:opacity-50">
          <Upload className="size-3.5" /> {isPending ? "Reconciling…" : "Reconcile statement"}
        </button>
      </form>

      {error ? <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs font-medium text-red-600">{error}</p> : null}

      {preview ? (
        <section className="space-y-4 rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Capture coverage</p><p className="mt-1 text-3xl font-bold tabular-nums">{preview.percentage}%</p><p className="mt-1 text-xs text-muted-foreground">{preview.matchedLines} matched / {preview.eligibleLines} purchase lines</p></div>
            <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{preview.tolerantLines} awaiting tip review · {preview.ambiguousLines} ambiguous · payments and credits excluded</div>
          </div>
          {preview.reviewLines.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border/80">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">Statement lines needing review</caption>
                <thead className="border-b border-border/60 bg-muted/30 text-muted-foreground"><tr><th className="px-3 py-2 font-semibold">Date</th><th className="px-3 py-2 font-semibold">Description</th><th className="px-3 py-2 font-semibold">Amount</th><th className="px-3 py-2 font-semibold">Status</th><th className="px-3 py-2" /></tr></thead>
                <tbody className="divide-y divide-border/60">
                  {preview.reviewLines.map((line) => {
                    const outcome = settled[line.id];
                    // A settled row reflects its new state immediately; rejecting a
                    // tolerant match hands the line back to the add-as-purchase flow.
                    const status = outcome === "matched" ? "matched" : outcome === "rejected" ? "rejected" : line.status;
                    const busy = pendingId === line.id;
                    return (
                      <tr key={line.id}>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground align-top">{line.date}</td>
                        <td className="px-3 py-2 align-top">
                          <span className="font-medium">{line.description}</span>
                          {status === "matched-tolerant" && line.matchedMerchant ? (
                            <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                              {line.matchedMerchant} captured {formatMinorUnits(line.amountMinor - (line.toleranceMinor ?? 0), currency)} · {formatMinorUnits(line.toleranceMinor ?? 0, currency)} more on the statement
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 tabular-nums align-top">{formatMinorUnits(line.amountMinor, currency)}</td>
                        <td className="px-3 py-2 text-muted-foreground align-top">{STATUS_LABEL[status] ?? status}</td>
                        <td className="px-3 py-2 text-right align-top">
                          {outcome === "added" ? <span className="text-[11px] font-semibold text-muted-foreground">Added</span>
                            : outcome === "matched" ? <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">Confirmed</span>
                            : status === "matched-tolerant" ? (
                              <div className="inline-flex gap-1.5">
                                <button type="button" disabled={busy} onClick={() => decideLine(line, "confirm")} className={`${action} border-emerald-600/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400`}><Check className="size-3" />{busy ? "Saving…" : "Same purchase"}</button>
                                <button type="button" disabled={busy} onClick={() => decideLine(line, "reject")} className={action}><X className="size-3" />Not a match</button>
                              </div>
                            )
                            : <button type="button" disabled={status === "ambiguous" || busy} onClick={() => addLine(line)} className={action}><Plus className="size-3" />{status === "ambiguous" ? "Review match" : busy ? "Adding…" : "Add as purchase"}</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-xs font-medium text-emerald-800 dark:text-emerald-300"><FileSpreadsheet className="size-4" />Every purchase line in this statement matched a capture.</div>}
        </section>
      ) : null}
    </div>
  );
}
