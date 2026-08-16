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

  // Reprocess state
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessProgress, setReprocessProgress] = useState(0);
  const [reprocessStats, setReprocessStats] = useState<{
    processed: number;
    succeeded: number;
    failed: number;
    totalCount: number;
  } | null>(null);
  const [reprocessErrors, setReprocessErrors] = useState<Array<{ messageId: string; error: string }>>([]);

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

  async function reprocessAll() {
    setReprocessing(true);
    setReprocessProgress(0);
    setReprocessStats(null);
    setReprocessErrors([]);

    let offset = 0;
    const batchSize = 50;
    let hasMore = true;
    let totalProcessed = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;
    let totalCount = 0;
    const allErrors: Array<{ messageId: string; error: string }> = [];

    try {
      while (hasMore) {
        const res = await fetch("/api/automation/reprocess", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offset, batchSize }),
        });

        if (!res.ok) {
          throw new Error(`Failed to reprocess: ${res.statusText}`);
        }

        const data = await res.json();
        totalProcessed += data.processed;
        totalSucceeded += data.succeeded;
        totalFailed += data.failed;
        totalCount = data.totalCount;
        hasMore = data.hasMore;
        offset = data.nextOffset ?? 0;

        if (data.errors && data.errors.length > 0) {
          allErrors.push(...data.errors);
        }

        setReprocessProgress(data.progress);
        setReprocessStats({
          processed: totalProcessed,
          succeeded: totalSucceeded,
          failed: totalFailed,
          totalCount,
        });
      }

      setReprocessErrors(allErrors);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reprocess failed");
    } finally {
      setReprocessing(false);
      await load(); // Refresh suggestions
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

      {/* Reprocess Section */}
      <div className="rounded-2xl border bg-indigo-50/50 p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Reprocess All Receipts</h2>
            <p className="mt-1 text-sm text-slate-600">
              Re-parse all Gmail receipts to fix parser errors or update transaction data.
              This runs in batches and may take a few minutes.
            </p>
          </div>
          <button
            onClick={reprocessAll}
            disabled={reprocessing || loading}
            className="rounded-full border border-indigo-600 bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {reprocessing ? "Processing..." : "Reprocess All"}
          </button>
        </div>

        {reprocessing && (
          <div className="mt-4 space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-indigo-600 transition-all duration-300"
                style={{ width: `${reprocessProgress}%` }}
              />
            </div>
            <div className="text-sm text-slate-600">
              {reprocessProgress}% complete
              {reprocessStats && ` • ${reprocessStats.processed}/${reprocessStats.totalCount} processed`}
            </div>
          </div>
        )}

        {reprocessStats && !reprocessing && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-xs font-medium text-slate-500">Total</div>
                <div className="text-xl font-bold text-slate-900">{reprocessStats.totalCount}</div>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-xs font-medium text-emerald-600">Succeeded</div>
                <div className="text-xl font-bold text-emerald-700">{reprocessStats.succeeded}</div>
              </div>
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                <div className="text-xs font-medium text-rose-600">Failed</div>
                <div className="text-xl font-bold text-rose-700">{reprocessStats.failed}</div>
              </div>
            </div>

            {reprocessErrors.length > 0 && (
              <details className="rounded-lg border border-rose-200 bg-rose-50 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-rose-800">
                  View Errors ({reprocessErrors.length})
                </summary>
                <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                  {reprocessErrors.map((err, idx) => (
                    <div key={idx} className="rounded-lg border border-rose-200 bg-white p-3 text-xs">
                      <div className="font-mono text-slate-600">Message: {err.messageId}</div>
                      <div className="mt-1 text-rose-700">{err.error}</div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
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
