"use client";

import useSWR from "swr";
import { useMemo, useState } from "react";
import Link from "next/link";

type NotificationType = "SUBSCRIPTION_RENEWAL_SOON" | "RETURN_DEADLINE_SOON" | "BILL_DUE_SOON" | "REFUND_CHECK_DUE" | "REFUND_OVERDUE" | "RETURN_DELIVERED";

type Notification = {
  id: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  eventDate?: string | null;
  scheduledFor: string;
  readAt?: string | null;
  dismissedAt?: string | null;
  sourceKind: string;
  sourceId: string;
};

const fetcher = (url: string) => fetch(url).then(r => r.json());

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

function formatDateLong(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return dateFormatter.format(d);
}

function typeLabel(t: NotificationType) {
  switch (t) {
    case "SUBSCRIPTION_RENEWAL_SOON": return "Subscription";
    case "RETURN_DEADLINE_SOON": return "Return";
    case "BILL_DUE_SOON": return "Bill";
    case "REFUND_CHECK_DUE": return "Refund check";
    case "REFUND_OVERDUE": return "Refund overdue";
    case "RETURN_DELIVERED": return "Delivered";
    default: return t;
  }
}

function typePill(t: NotificationType) {
  const map: Record<NotificationType, string> = {
    SUBSCRIPTION_RENEWAL_SOON: "bg-emerald-500/20 text-emerald-100",
    RETURN_DEADLINE_SOON: "bg-cyan-500/20 text-cyan-100",
    BILL_DUE_SOON: "bg-indigo-500/20 text-indigo-100",
    REFUND_CHECK_DUE: "bg-amber-500/20 text-amber-100",
    REFUND_OVERDUE: "bg-rose-500/20 text-rose-100",
    RETURN_DELIVERED: "bg-emerald-500/20 text-emerald-100",
  };
  return map[t] ?? "bg-white/10 text-slate-100";
}

export default function NotificationsClient() {
  const { data, mutate, isLoading } = useSWR("/api/notifications?limit=200", fetcher, { refreshInterval: 30000 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notifications = useMemo<Notification[]>(() => data?.notifications ?? [], [data?.notifications]);
  const unread = notifications.filter(n => !n.readAt && !n.dismissedAt);

  const grouped = useMemo(() => {
    const map = new Map<NotificationType, Notification[]>();
    for (const n of notifications) {
      if (!map.has(n.type)) map.set(n.type, []);
      map.get(n.type)!.push(n);
    }
    for (const [k, arr] of map) {
      arr.sort((a, b) => (a.scheduledFor > b.scheduledFor ? -1 : 1));
      map.set(k, arr);
    }
    return map;
  }, [notifications]);

  async function mark(ids: string[], action: "READ" | "UNREAD" | "DISMISS") {
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to update notifications");
        return;
      }
      await mutate();
    } catch (err: any) {
      setError(err?.message ?? "Network error updating notifications");
    } finally {
      setBusy(false);
    }
  }

  async function markAllRead() {
    await mark(unread.map(n => n.id), "READ");
  }

  function linkFor(n: Notification) {
    if (n.sourceKind === "bill") return "/bills/month";
    if (n.sourceKind === "subscription") return "/subscriptions";
    if (n.sourceKind === "return") return "/returns";
    return null;
  }

  if (isLoading) {
    return <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200 shadow-sm">Loading…</div>;
  }

  return (
    <div className="space-y-4 text-slate-100">
      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-medium text-rose-300" role="alert">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded-full bg-white/10 px-3 py-1 text-white">Unread</span>
          <span className="rounded-full bg-white/10 px-3 py-1 text-slate-100">{unread.length}</span>
        </div>
        <div className="flex gap-2 text-sm">
          <button
            className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-slate-100 transition hover:border-cyan-200/40 hover:bg-white/10 disabled:opacity-50"
            onClick={markAllRead}
            disabled={busy || unread.length === 0}
          >
            Mark all read
          </button>
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200 shadow-sm">
          No notifications yet.
        </div>
      ) : (
        Array.from(grouped.entries()).map(([type, items]) => (
          <div key={type} className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/25">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${typePill(type)}`}>{typeLabel(type)}</span>
                <span className="text-xs text-slate-300">{items.length} items</span>
              </div>
              <button
                className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-100 transition hover:border-cyan-200/40 hover:bg-white/10 disabled:opacity-50"
                onClick={() => mark(items.map(i => i.id), "READ")}
                disabled={busy}
              >
                Mark read
              </button>
            </div>

            <div className="divide-y divide-white/10">
              {items.map((n) => {
                const link = linkFor(n);
                return (
                  <div key={n.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">{n.title}</span>
                        {!n.readAt ? <span className="rounded-full bg-emerald-500/80 px-2 py-0.5 text-[10px] font-semibold text-slate-950">new</span> : null}
                      </div>
                      {n.body ? <div className="text-xs text-slate-200/90">{n.body}</div> : null}
                      <div className="text-[11px] text-slate-300">
                        <span className="font-semibold text-slate-100">Notifies on:</span> {formatDateLong(n.scheduledFor)}
                        {n.eventDate ? (
                          <>
                            <span className="mx-1 text-slate-500">•</span>
                            <span className="font-semibold text-slate-100">Event date:</span> {formatDateLong(n.eventDate)}
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      {link ? (
                        <Link className="pill-link" href={link}>
                          View item
                        </Link>
                      ) : null}
                      {!n.readAt ? (
                        <button
                          className="rounded-full border border-white/15 bg-white/5 px-3 py-1 font-semibold text-slate-100 transition hover:border-cyan-200/40 hover:bg-white/10 disabled:opacity-50"
                          onClick={() => mark([n.id], "READ")}
                          disabled={busy}
                        >
                          Mark read
                        </button>
                      ) : (
                        <button
                          className="rounded-full border border-white/15 bg-white/5 px-3 py-1 font-semibold text-slate-100 transition hover:border-cyan-200/40 hover:bg-white/10 disabled:opacity-50"
                          onClick={() => mark([n.id], "UNREAD")}
                          disabled={busy}
                        >
                          Mark unread
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
