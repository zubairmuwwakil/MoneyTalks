"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/utils/calendarEvents";

type SubscriptionItem = {
  id: string;
  name: string;
  amountCents: number;
  currency: string;
  renewalDate: string;
  cadence: "MONTHLY" | "YEARLY" | "CUSTOM";
  status: "ACTIVE" | "CANCELLED";
  notes: string | null;
};

const cadenceCopy: Record<SubscriptionItem["cadence"], string> = {
  MONTHLY: "Monthly",
  YEARLY: "Annual",
  CUSTOM: "Custom",
};

export default function SubscriptionsBoard({ items }: { items: SubscriptionItem[] }) {
  const [cadenceFilter, setCadenceFilter] = useState<SubscriptionItem["cadence"] | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<SubscriptionItem["status"] | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [data, setData] = useState(items);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; amount: string; renewalDate: string; cadence: SubscriptionItem["cadence"] }>({
    name: "",
    amount: "",
    renewalDate: "",
    cadence: "MONTHLY",
  });
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    return data.filter(item => {
      if (cadenceFilter !== "ALL" && item.cadence !== cadenceFilter) return false;
      if (statusFilter !== "ALL" && item.status !== statusFilter) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        if (!item.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [cadenceFilter, data, query, statusFilter]);

  const grouped = useMemo(() => {
    const groups: Record<SubscriptionItem["cadence"], SubscriptionItem[]> = { MONTHLY: [], YEARLY: [], CUSTOM: [] };
    for (const item of filtered) {
      groups[item.cadence].push(item);
    }
    return groups;
  }, [filtered]);

  function startEdit(item: SubscriptionItem) {
    setEditingId(item.id);
    setDraft({
      name: item.name,
      amount: (item.amountCents / 100).toFixed(2),
      renewalDate: item.renewalDate.slice(0, 10),
      cadence: item.cadence,
    });
  }

  async function save() {
    if (!editingId) return;
    setSaving(true);
    try {
      const amountCents = Math.round(Number(draft.amount) * 100);
      await fetch(`/api/subscriptions/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          amountCents: Number.isFinite(amountCents) ? amountCents : undefined,
          renewalDate: draft.renewalDate ? `${draft.renewalDate}T00:00:00.000Z` : undefined,
          cadence: draft.cadence,
        }),
      });
      setData(prev =>
        prev.map(item =>
          item.id === editingId
            ? { ...item, name: draft.name, amountCents, renewalDate: `${draft.renewalDate}T00:00:00.000Z`, cadence: draft.cadence }
            : item
        )
      );
      setEditingId(null);
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
            {(["ALL", "MONTHLY", "YEARLY", "CUSTOM"] as const).map(option => (
              <button
                key={option}
                onClick={() => setCadenceFilter(option === "ALL" ? "ALL" : option)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  cadenceFilter === option
                    ? "border-emerald-200/60 bg-emerald-500/20 text-emerald-50"
                    : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/10"
                }`}
              >
                {option === "ALL" ? "All" : cadenceCopy[option as SubscriptionItem["cadence"]]}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(["ALL", "ACTIVE", "CANCELLED"] as const).map(option => (
            <button
              key={option}
              onClick={() => setStatusFilter(option === "ALL" ? "ALL" : (option as SubscriptionItem["status"]))}
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
        {(["MONTHLY", "YEARLY", "CUSTOM"] as SubscriptionItem["cadence"][]).map(cadence => {
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
                            <p className="text-xs text-slate-400">{cadenceCopy[item.cadence]}</p>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${item.status === "ACTIVE" ? "bg-emerald-500/20 text-emerald-50" : "bg-slate-500/25 text-slate-100"}`}>
                            {item.status.toLowerCase()}
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
                            <span>{formatMoney(item.amountCents, item.currency)}</span>
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
                              {new Date(item.renewalDate).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                            </span>
                          )}
                        </div>

                        {isEditing ? (
                          <div className="mt-2 flex items-center gap-2">
                            <select
                              value={draft.cadence}
                              onChange={e => setDraft(d => ({ ...d, cadence: e.target.value as SubscriptionItem["cadence"] }))}
                              className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-sm text-slate-100"
                            >
                              <option value="MONTHLY">Monthly</option>
                              <option value="YEARLY">Annual</option>
                              <option value="CUSTOM">Custom</option>
                            </select>
                            <button
                              onClick={save}
                              disabled={saving}
                              className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold text-slate-100 transition hover:border-emerald-200/50 hover:bg-white/10 disabled:opacity-60"
                            >
                              {saving ? "Saving…" : "Save"}
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/10"
                            >
                              Cancel
                            </button>
                          </div>
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
