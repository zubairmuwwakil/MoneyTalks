"use client";

import { useEffect, useMemo, useState } from "react";

type DetectedType = "TRIAL" | "RENEWAL" | "BILL";

type DetectedItem = {
  id: string;
  type: DetectedType;
  merchant: string;
  amountCents?: number | null;
  currency?: string | null;
  date: string;
  confidence: string;
  status: "NEW" | "CONFIRMED" | "DISMISSED";
};

type Subscription = {
  id: string;
  name: string;
};

function money(cents?: number | null, currency?: string | null) {
  if (typeof cents !== "number") return null;
  return `${currency ?? "CAD"} ${(cents / 100).toFixed(2)}`;
}

export default function DetectedInbox() {
  const [items, setItems] = useState<DetectedItem[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [linkSub, setLinkSub] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    const [detRes, subRes] = await Promise.all([
      fetch("/api/automation/detected", { cache: "no-store" }),
      fetch("/api/subscriptions", { cache: "no-store" }),
    ]);
    const detData = await detRes.json();
    const subData = await subRes.json();
    setItems(detData.items ?? []);
    setSubs(subData.subscriptions ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const newItems = useMemo(() => items.filter(i => i.status === "NEW"), [items]);

  async function act(id: string, action: "KEEP" | "CANCEL" | "SNOOZE" | "DOWNGRADE" | "SWITCH_ANNUAL") {
    setBusyId(id);
    try {
      await fetch("/api/automation/detected", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          action,
          subscriptionId: linkSub[id] || undefined,
        }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="rounded-2xl border bg-white/80 p-6 text-sm text-slate-600">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white/80 p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Detected</h1>
        <p className="text-sm text-slate-600">Auto-detected trials and renewals. Confirm or dismiss in one tap.</p>
      </div>

      {newItems.length === 0 ? (
        <div className="rounded-2xl border bg-white/80 p-6 text-sm text-slate-600">Nothing detected yet.</div>
      ) : (
        newItems.map(item => (
          <div key={item.id} className="rounded-2xl border bg-white/80 p-6 shadow-sm space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  {item.merchant} {item.type === "TRIAL" ? "trial ends" : item.type === "RENEWAL" ? "renewal" : "bill"}
                </div>
                <div className="text-sm text-slate-600">
                  {new Date(item.date).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                  {item.amountCents ? ` · ${money(item.amountCents, item.currency)}` : ""}
                </div>
                {item.type === "TRIAL" ? (
                  <div className="mt-1 text-xs text-amber-700">Price may change after trial.</div>
                ) : null}
              </div>

              <div className="text-xs text-slate-500">Confidence: {item.confidence}</div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded-full border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60"
                onClick={() => act(item.id, "KEEP")}
                disabled={busyId === item.id}
              >
                Keep
              </button>
              <button
                className="rounded-full border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60"
                onClick={() => act(item.id, "CANCEL")}
                disabled={busyId === item.id}
              >
                Cancel
              </button>
              <button
                className="rounded-full border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60"
                onClick={() => act(item.id, "SNOOZE")}
                disabled={busyId === item.id}
              >
                Snooze
              </button>
              <button
                className="rounded-full border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60"
                onClick={() => act(item.id, "DOWNGRADE")}
                disabled={busyId === item.id}
              >
                Downgrade
              </button>
              <button
                className="rounded-full border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60"
                onClick={() => act(item.id, "SWITCH_ANNUAL")}
                disabled={busyId === item.id}
              >
                Switch annual
              </button>

              {subs.length > 0 ? (
                <div className="ml-auto flex items-center gap-2 text-sm">
                  <span className="text-slate-500">Link to</span>
                  <select
                    className="rounded-lg border px-2 py-1 text-sm"
                    value={linkSub[item.id] ?? ""}
                    onChange={e => setLinkSub(prev => ({ ...prev, [item.id]: e.target.value }))}
                  >
                    <option value="">Select subscription</option>
                    {subs.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
