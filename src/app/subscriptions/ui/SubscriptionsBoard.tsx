"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ObligationLifecycleStatus } from "@prisma/client";
import type { CanonicalCadenceType } from "@/lib/domain/recurring/readModel";
import { formatMoney } from "@/lib/utils/calendarEvents";

type SubscriptionItem = {
  id: string;
  name: string;
  amountCents: number | null;
  currency: string | null;
  renewalDate: string | null;
  cadence: CanonicalCadenceType | null;
  lifecycleStatus: ObligationLifecycleStatus | null;
  notes: string | null;
};

const CADENCES: CanonicalCadenceType[] = ["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"];
const cadenceCopy: Record<CanonicalCadenceType | "UNKNOWN", string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every two weeks",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  SEMIANNUAL: "Every six months",
  ANNUAL: "Annual",
  UNKNOWN: "Cadence unknown",
};

const STATUSES: ObligationLifecycleStatus[] = ["TRIALING", "ACTIVE", "CANCELLING", "CANCELLED", "LAPSED"];

export default function SubscriptionsBoard({ items }: { items: SubscriptionItem[] }) {
  const [cadenceFilter, setCadenceFilter] = useState<CanonicalCadenceType | "UNKNOWN" | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<ObligationLifecycleStatus | "UNKNOWN" | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [data, setData] = useState(items);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; amount: string; renewalDate: string; cadence: CanonicalCadenceType }>({
    name: "",
    amount: "",
    renewalDate: "",
    cadence: "MONTHLY",
  });
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return data.filter(item => {
      if (cadenceFilter !== "ALL" && (item.cadence ?? "UNKNOWN") !== cadenceFilter) return false;
      if (statusFilter !== "ALL" && (item.lifecycleStatus ?? "UNKNOWN") !== statusFilter) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        if (!item.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [cadenceFilter, data, query, statusFilter]);

  const grouped = useMemo(() => {
    const groups: Record<CanonicalCadenceType | "UNKNOWN", SubscriptionItem[]> = {
      WEEKLY: [], BIWEEKLY: [], MONTHLY: [], QUARTERLY: [], SEMIANNUAL: [], ANNUAL: [], UNKNOWN: [],
    };
    for (const item of filtered) {
      groups[item.cadence ?? "UNKNOWN"].push(item);
    }
    return groups;
  }, [filtered]);

  function startEdit(item: SubscriptionItem) {
    setEditingId(item.id);
    setEditError(null);
    setDraft({
      name: item.name,
      amount: item.amountCents == null ? "" : (item.amountCents / 100).toFixed(2),
      renewalDate: item.renewalDate?.slice(0, 10) ?? "",
      cadence: item.cadence ?? "MONTHLY",
    });
  }

  async function save() {
    if (!editingId) return;
    setSaving(true);
    setEditError(null);
    try {
      const amountCents = draft.amount.trim() ? Math.round(Number(draft.amount) * 100) : Number.NaN;
      const occurredAt = new Date().toISOString();
      const facts = [
        ...(Number.isFinite(amountCents) ? [{ type: "PRICE_CHANGE", occurredAt, amountMinor: amountCents, currency: data.find((item) => item.id === editingId)?.currency ?? "CAD" }] : []),
        ...(draft.renewalDate ? [{ type: "NEXT_BILLING_DATE", occurredAt, billingAt: `${draft.renewalDate}T00:00:00.000Z` }] : []),
        { type: "EXPLICIT_CADENCE", occurredAt, cadence: draft.cadence },
      ];
      const res = await fetch(`/api/recurring/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          metadata: { displayName: draft.name },
          facts,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setEditError(data.error ?? "Failed to save subscription changes");
        return;
      }
      setData(prev =>
        prev.map(item =>
          item.id === editingId
            ? { ...item, name: draft.name, amountCents: Number.isFinite(amountCents) ? amountCents : item.amountCents, renewalDate: draft.renewalDate ? `${draft.renewalDate}T00:00:00.000Z` : item.renewalDate, cadence: draft.cadence }
            : item
        )
      );
      setEditingId(null);
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "Network error saving subscription");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Filters</p>
            <p className="text-sm text-slate-200">Group by cadence, inline edits, cancel view.</p>
          </div>
          <div className="flex items-center gap-2">
            {(["ALL", ...CADENCES, "UNKNOWN"] as const).map(option => (
              <button
                key={option}
                onClick={() => setCadenceFilter(option === "ALL" ? "ALL" : option)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  cadenceFilter === option
                    ? "border-emerald-200/60 bg-emerald-500/20 text-emerald-50"
                    : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/10"
                }`}
              >
                {option === "ALL" ? "All" : cadenceCopy[option]}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(["ALL", ...STATUSES, "UNKNOWN"] as const).map(option => (
            <button
              key={option}
              onClick={() => setStatusFilter(option)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                statusFilter === option
                  ? "border-cyan-200/60 bg-cyan-500/20 text-cyan-50"
                  : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/10"
              }`}
            >
              {option === "ALL" ? "All statuses" : option.toLowerCase()}
            </button>
          ))}
          <div className="flex-1 min-w-[220px] rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-slate-100">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search subscriptions…"
              className="w-full bg-transparent text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {([...CADENCES, "UNKNOWN"] as const).map(cadence => {
          const list = grouped[cadence];
          return (
            <div key={cadence} className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl shadow-black/30">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">{cadenceCopy[cadence]}</p>
                  <p className="text-sm text-slate-200">{list.length} items</p>
                </div>
                <span className="rounded-full bg-white/10 px-2 py-1 text-[11px] font-semibold text-white">Next renewal</span>
              </div>

              <div className="mt-3 space-y-2">
                {list.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 bg-black/20 px-3 py-5 text-center text-sm text-slate-300">
                    No {cadenceCopy[cadence].toLowerCase()} subscriptions.
                  </div>
                ) : (
                  list.map(item => {
                    const isEditing = editingId === item.id;
                    return (
                      <div key={item.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            {isEditing ? (
                              <input
                                value={draft.name}
                                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                                className="w-full rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-sm text-slate-100"
                              />
                            ) : (
                              <p className="text-sm font-semibold text-white">{item.name}</p>
                            )}
                            <p className="text-xs text-slate-400">{cadenceCopy[item.cadence ?? "UNKNOWN"]}</p>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${item.lifecycleStatus === "ACTIVE" ? "bg-emerald-500/20 text-emerald-50" : item.lifecycleStatus === "CANCELLING" || item.lifecycleStatus === "TRIALING" ? "bg-amber-500/20 text-amber-50" : "bg-slate-500/25 text-slate-100"}`}>
                            {(item.lifecycleStatus ?? "UNKNOWN").toLowerCase()}
                          </span>
                        </div>

                        <div className="mt-2 flex items-center justify-between text-sm text-slate-200">
                          {isEditing ? (
                            <input
                              value={draft.amount}
                              onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))}
                              className="w-32 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-sm text-slate-100"
                            />
                          ) : (
                            <span>{item.amountCents == null ? "Amount unknown" : formatMoney(item.amountCents, item.currency)}</span>
                          )}
                          {isEditing ? (
                            <input
                              type="date"
                              value={draft.renewalDate}
                              onChange={e => setDraft(d => ({ ...d, renewalDate: e.target.value }))}
                              className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-sm text-slate-100"
                            />
                          ) : (
                            <span className="rounded-full bg-white/10 px-2 py-1 text-[11px] text-emerald-100">
                              {item.renewalDate ? new Date(item.renewalDate).toLocaleDateString("en-CA", { month: "short", day: "numeric" }) : "Date unknown"}
                            </span>
                          )}
                        </div>

                        {isEditing ? (
                          <>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <select
                                value={draft.cadence}
                                onChange={e => setDraft(d => ({ ...d, cadence: e.target.value as CanonicalCadenceType }))}
                                className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-sm text-slate-100"
                              >
                                {CADENCES.map((option) => <option key={option} value={option}>{cadenceCopy[option]}</option>)}
                              </select>
                              <button
                                onClick={save}
                                disabled={saving}
                                className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold text-slate-100 transition hover:border-emerald-200/50 hover:bg-white/10 disabled:opacity-60 cursor-pointer"
                              >
                                {saving ? "Saving…" : "Save"}
                              </button>
                              <button
                                onClick={() => {
                                  setEditingId(null);
                                  setEditError(null);
                                }}
                                className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/10 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                            {editError ? (
                              <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs font-medium text-rose-300" role="alert">
                                {editError}
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                            <span>{item.notes ?? "No notes"}</span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => startEdit(item)}
                                className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold text-slate-100 transition hover:border-cyan-200/50 hover:bg-white/10"
                              >
                                Edit inline
                              </button>
                              <Link href="/notifications" className="text-[11px] font-semibold text-cyan-100 hover:text-white">
                                View notifications ↗
                              </Link>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
