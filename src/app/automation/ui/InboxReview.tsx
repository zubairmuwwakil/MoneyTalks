"use client";

import { useEffect, useMemo, useState } from "react";

type SuggestionType = "RETURN" | "SUBSCRIPTION" | "BILL";
type SuggestionStatus = "NEW" | "CONFIRMED" | "IGNORED";

type UiSuggestion = {
  id: string;
  type: SuggestionType;
  merchant: string;
  amountCents?: number;
  currency: string;
  detectedDate: string; // YYYY-MM-DD
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasons: string[];
  source: { provider: "gmail" | "outlook"; messageIds: string[] };
  draft: Record<string, unknown>;
  status: SuggestionStatus;
};

type Edits = Record<
  string,
  {
    merchant: string;
    type: SuggestionType;
  }
>;

function money(cents?: number, currency?: string) {
  if (typeof cents !== "number") return null;
  const val = (cents / 100).toFixed(2);
  return `${currency ?? "CAD"} ${val}`;
}

export default function InboxReview() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<UiSuggestion[]>([]);
  const [edits, setEdits] = useState<Edits>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/automation/suggestions", { cache: "no-store" });
      const text = await res.text();
      const data = JSON.parse(text);

      const rows: UiSuggestion[] = data?.suggestions ?? [];
      setSuggestions(rows);

      const initial: Edits = {};
      for (const s of rows) {
        initial[s.id] = {
          merchant: s.merchant ?? "",
          type: s.type ?? "RETURN",
        };
      }
      setEdits(initial);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load suggestions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const newSuggestions = useMemo(
    () => suggestions.filter((s) => s.status === "NEW"),
    [suggestions]
  );

  function setEdit(id: string, patch: Partial<Edits[string]>) {
    setEdits((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { merchant: "", type: "RETURN" }), ...patch },
    }));
  }

  async function ignore(id: string) {
    setBusyId(id);
    try {
      await fetch("/api/automation/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "IGNORE" }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function confirm(id: string) {
    const e = edits[id];
    setBusyId(id);
    try {
      await fetch("/api/automation/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          action: "CONFIRM",
          draft: {
            merchant: e?.merchant,
            type: e?.type,
          },
        }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="rounded-2xl border bg-white/80 p-6 text-sm text-slate-600">Loading…</div>;
  if (error) return <div className="rounded-2xl border bg-rose-50 p-6 text-sm text-rose-700">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white/80 p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Inbox Review</h1>
        <p className="text-sm text-slate-600">Scans last 90 days. Nothing is created until you confirm.</p>
      </div>

      {newSuggestions.length === 0 ? (
        <div className="rounded-2xl border bg-white/80 p-4 text-sm text-slate-600">
          No new suggestions right now.
        </div>
      ) : (
        <div className="space-y-3">
          {newSuggestions.map((s) => {
            const e = edits[s.id] ?? { merchant: s.merchant, type: s.type };
            const disabled = busyId === s.id;

            return (
              <div key={s.id} className="rounded-2xl border bg-white/80 p-4 shadow-sm space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-slate-900">
                      {e.merchant || "Untitled"}{" "}
                      <span className="ml-2 text-xs text-slate-500">
                        {s.detectedDate} · {s.confidence}
                      </span>
                    </div>
                    <div className="text-sm text-slate-600">
                      {money(s.amountCents, s.currency) ?? "Amount unknown"}
                    </div>
                    {Array.isArray(s.reasons) && s.reasons.length > 0 ? (
                      <div className="text-xs text-slate-500">{s.reasons.join(" · ")}</div>
                    ) : null}
                  </div>

                  <div className="flex gap-2">
                    <button
                      className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                      onClick={() => ignore(s.id)}
                      disabled={disabled}
                    >
                      Ignore
                    </button>
                    <button
                      className="rounded-full border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                      onClick={() => confirm(s.id)}
                      disabled={disabled}
                    >
                      Confirm
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-slate-500">Merchant</div>
                    <input
                      className="w-full rounded-xl border px-3 py-2 text-sm"
                      value={e.merchant}
                      onChange={(ev) => setEdit(s.id, { merchant: ev.target.value })}
                      placeholder="e.g. Netflix"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-slate-500">Type</div>
                    <select
                      className="w-full rounded-xl border px-3 py-2 text-sm"
                      value={e.type}
                      onChange={(ev) => setEdit(s.id, { type: ev.target.value as SuggestionType })}
                    >
                      <option value="RETURN">Return</option>
                      <option value="SUBSCRIPTION">Subscription</option>
                      <option value="BILL">Bill</option>
                    </select>
                  </div>
                </div>

                <details className="text-xs text-slate-500">
                  <summary className="cursor-pointer">Details</summary>
                  <pre className="mt-2 overflow-auto rounded-xl border bg-white p-3 text-[11px] text-slate-700">
{JSON.stringify(s.draft ?? {}, null, 2)}
                  </pre>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
