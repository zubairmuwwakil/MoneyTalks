"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Check, CheckCircle2, Package, RefreshCw, Truck } from "lucide-react";
import { formatMoney } from "@/lib/utils/calendarEvents";

type ReturnItem = {
  id: string;
  store: string;
  itemNote: string | null;
  amountCents: number | null;
  currency: string;
  purchaseDate: string;
  returnBy: string;
  returnWindowDays: number;
  refundAmountCents: number | null;
  refundExpectedAt: string | null;
  refundedDate: string | null;
  status: "NOT_STARTED" | "PACKED" | "DROPPED_OFF" | "DELIVERED" | "REFUNDED";
  dropoffDate: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  deliveredAt: string | null;
  refundSlaDays: number;
  refundType: string | null;
};

type Stats = {
  total: number;
  refunded: number;
  inProgress: number;
  totalRefunded: number;
  potentialRefunds: number;
};

type StageKey = "to_ship" | "in_transit" | "delivered" | "refund_overdue";

const stageMeta: Record<StageKey, { label: string; accent: string; icon: ReactNode }> = {
  to_ship: { label: "To ship", accent: "from-cyan-400/25 to-blue-500/10", icon: <Package className="h-4 w-4" /> },
  in_transit: { label: "In transit", accent: "from-blue-400/25 to-indigo-500/10", icon: <Truck className="h-4 w-4" /> },
  delivered: { label: "Delivered", accent: "from-emerald-400/25 to-emerald-500/10", icon: <CheckCircle2 className="h-4 w-4" /> },
  refund_overdue: { label: "Refund overdue", accent: "from-rose-400/25 to-amber-500/10", icon: <AlertTriangle className="h-4 w-4" /> },
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function daysUntil(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  const diff = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return diff;
}

function deriveStage(item: ReturnItem): StageKey | "refunded" {
  if (item.status === "REFUNDED" || item.refundedDate) return "refunded";
  const expected = item.refundExpectedAt ? new Date(item.refundExpectedAt) : null;
  if (expected && expected.getTime() < Date.now()) return "refund_overdue";
  if (item.deliveredAt) return "delivered";
  if (item.dropoffDate) return "in_transit";
  return "to_ship";
}

function normalizeReturn(r: any): ReturnItem {
  return {
    id: r.id,
    store: r.store,
    itemNote: r.itemNote ?? null,
    amountCents: r.amountCents ?? null,
    currency: r.currency ?? "CAD",
    purchaseDate: typeof r.purchaseDate === "string" ? r.purchaseDate : new Date(r.purchaseDate).toISOString(),
    returnBy: typeof r.returnBy === "string" ? r.returnBy : new Date(r.returnBy).toISOString(),
    returnWindowDays: r.returnWindowDays ?? 30,
    refundAmountCents: r.refundAmountCents ?? null,
    refundExpectedAt: r.refundExpectedAt ? new Date(r.refundExpectedAt).toISOString() : null,
    refundedDate: r.refundedDate ? new Date(r.refundedDate).toISOString() : null,
    status: r.status,
    dropoffDate: r.dropoffDate ? new Date(r.dropoffDate).toISOString() : null,
    trackingNumber: r.trackingNumber ?? null,
    carrier: r.carrier ?? null,
    deliveredAt: r.deliveredAt ? new Date(r.deliveredAt).toISOString() : null,
    refundSlaDays: r.refundSlaDays ?? 14,
    refundType: r.refundType ?? null,
  };
}

export default function ReturnsBoard({
  items,
  stats,
  initialBucket,
  onBucketChange,
}: {
  items: ReturnItem[];
  stats: Stats;
  initialBucket: "active" | "refunded";
  onBucketChange?: (bucket: "active" | "refunded") => void;
}) {
  const [bucket, setBucket] = useState<"active" | "refunded">(initialBucket);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<ReturnItem[]>(items);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    setBucket(initialBucket);
  }, [initialBucket]);

  const filtered = useMemo(() => {
    return data.filter(item => {
      if (bucket === "refunded" && item.status !== "REFUNDED") return false;
      if (bucket === "active" && item.status === "REFUNDED") return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        const combined = `${item.store} ${item.itemNote ?? ""}`.toLowerCase();
        if (!combined.includes(q)) return false;
      }
      return true;
    });
  }, [bucket, data, query]);

  const activeItems = filtered.filter(i => i.status !== "REFUNDED");
  const refundedItems = filtered.filter(i => i.status === "REFUNDED");

  const grouped = useMemo(() => {
    const base: Record<StageKey, ReturnItem[]> = { to_ship: [], in_transit: [], delivered: [], refund_overdue: [] };
    for (const item of activeItems) {
      const stage = deriveStage(item);
      if (stage === "refunded") continue;
      base[stage].push(item);
    }
    return base;
  }, [activeItems]);

  async function markReturned(id: string) {
    setLoadingId(id + "-returned");
    try {
      const res = await fetch(`/api/returns/${id}/mark-returned`, { method: "POST" });
      const json = await res.json().catch(() => null);
      const next = json?.returnItem ? normalizeReturn(json.returnItem) : null;
      setData(prev =>
        prev.map(item =>
          item.id === id
            ? next ?? { ...item, status: "DROPPED_OFF", dropoffDate: new Date().toISOString() }
            : item
        )
      );
    } finally {
      setLoadingId(null);
    }
  }

  async function markRefunded(item: ReturnItem) {
    setLoadingId(item.id + "-refunded");
    try {
      const res = await fetch(`/api/returns/${item.id}/mark-refunded`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refundAmountCents: item.amountCents ?? undefined }),
      });
      const json = await res.json().catch(() => null);
      const next = json?.returnItem ? normalizeReturn(json.returnItem) : null;
      const nowISO = new Date().toISOString();
      setData(prev =>
        prev.map(it =>
          it.id === item.id
            ? next ?? { ...it, status: "REFUNDED", refundedDate: nowISO, refundAmountCents: item.amountCents ?? it.refundAmountCents }
            : it
        )
      );
    } finally {
      setLoadingId(null);
    }
  }

  async function refreshShipment(id: string) {
    setLoadingId(id + "-refresh");
    try {
      const res = await fetch(`/api/returns/${id}/refresh-shipment`, { method: "POST" });
      const json = await res.json().catch(() => null);
      const next = json?.returnItem ? normalizeReturn(json.returnItem) : null;
      if (next) {
        setData(prev => prev.map(item => (item.id === id ? next : item)));
      }
    } finally {
      setLoadingId(null);
    }
  }

  function stageChip(item: ReturnItem) {
    const stage = deriveStage(item);
    if (stage === "refunded") return null;
    const meta = stageMeta[stage];
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-white">
        {meta.icon}
        {meta.label}
      </span>
    );
  }

  const headerButtons = (
    <div className="flex items-center gap-2">
      {(["active", "refunded"] as const).map(b => (
        <button
          key={b}
          onClick={() => {
            setBucket(b);
            onBucketChange?.(b);
          }}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
            bucket === b ? "bg-white/15 text-white" : "bg-white/5 text-slate-300 hover:text-white"
          }`}
        >
          {b === "active" ? "Active" : "Refunded"}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Returns board</p>
            <p className="text-sm text-slate-200">Estimated: label → in transit → delivered → refund expected.</p>
          </div>
          {headerButtons}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search store or note…"
              className="w-full bg-transparent text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </div>
          <div className="text-xs text-slate-400">
            {stats.inProgress} active · {stats.refunded} refunded · Potential {formatMoney(stats.potentialRefunds, "CAD")}
          </div>
        </div>
      </div>

      {bucket === "refunded" ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
          {refundedItems.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-300">No refunded items yet.</div>
          ) : (
            <div className="space-y-3">
              {refundedItems.map(item => (
                <div key={item.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100">
                  <div>
                    <div className="font-semibold text-white">{item.store}</div>
                    <div className="text-xs text-slate-400">{item.itemNote}</div>
                  </div>
                  <div className="text-right text-xs text-slate-300">
                    Refunded {formatDate(item.refundedDate)}
                    <div className="text-sm font-semibold text-emerald-100">{formatMoney(item.refundAmountCents ?? item.amountCents ?? 0, item.currency)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {(Object.keys(stageMeta) as StageKey[]).map(stage => {
            const itemsForStage = grouped[stage];
            const meta = stageMeta[stage];
            return (
              <div key={stage} className={`rounded-3xl border border-white/10 bg-gradient-to-br ${meta.accent} p-4`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.24em] text-slate-300">{meta.label}</p>
                    <p className="text-xs text-slate-200">{meta.label === "Refund overdue" ? "Follow up on missing refunds" : "Estimated shipment + SLA"}</p>
                  </div>
                  <span className="rounded-full bg-white/10 px-2 py-1 text-xs font-semibold text-white">{itemsForStage.length}</span>
                </div>
                <div className="mt-3 space-y-3">
                  {itemsForStage.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-4 text-xs text-slate-300">Nothing here yet.</div>
                  ) : (
                    itemsForStage.map(item => {
                      const expected = item.refundExpectedAt ? new Date(item.refundExpectedAt) : null;
                      const daysLeft = daysUntil(item.returnBy);
                      const refundDue = expected ? daysUntil(item.refundExpectedAt) : null;
                      const loading = loadingId?.startsWith(item.id);
                      return (
                        <div key={item.id} className="rounded-2xl border border-white/15 bg-white/5 p-3 shadow-sm">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-white">{item.store}</p>
                              <p className="text-xs text-slate-400">{item.itemNote}</p>
                              <div className="mt-1 text-[11px] text-slate-400">
                                Return by {formatDate(item.returnBy)} {daysLeft != null && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-emerald-100">{Math.max(daysLeft, 0)}d</span>}
                              </div>
                            </div>
                            <div className="text-right text-xs text-slate-300">
                              {stageChip(item)}
                              <div className="mt-1 text-sm font-semibold text-white">
                                {item.amountCents != null ? formatMoney(item.amountCents, item.currency) : "—"}
                              </div>
                            </div>
                          </div>
                          <div className="mt-2 text-[11px] text-slate-400">
                            Tracking {item.trackingNumber ?? "—"} {item.carrier ? `· ${item.carrier}` : ""}
                            {item.deliveredAt ? <> · Delivered {formatDate(item.deliveredAt)}</> : item.dropoffDate ? <> · Dropped {formatDate(item.dropoffDate)}</> : null}
                          </div>
                          {expected && (
                            <div className={`mt-2 rounded-xl px-3 py-2 text-xs ${stage === "refund_overdue" ? "bg-rose-500/10 text-rose-100" : "bg-emerald-500/10 text-emerald-50"}`}>
                              Estimated refund by {formatDate(item.refundExpectedAt)}{" "}
                              {refundDue != null ? (
                                <span className="ml-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold">
                                  {refundDue < 0 ? `${Math.abs(refundDue)}d overdue` : `${refundDue}d`}
                                </span>
                              ) : null}
                            </div>
                          )}
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {(stage === "to_ship" || stage === "in_transit") && (
                              <button
                                onClick={() => markReturned(item.id)}
                                disabled={loading}
                                className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-white/15 disabled:opacity-60"
                              >
                                <Check className="h-3 w-3" />
                                Mark dropped
                              </button>
                            )}
                            <button
                              onClick={() => refreshShipment(item.id)}
                              disabled={loading || !item.trackingNumber}
                              className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold text-slate-100 transition hover:border-white/25 hover:bg-white/10 disabled:opacity-50"
                            >
                              <RefreshCw className="h-3 w-3" />
                              Refresh
                            </button>
                            {stage !== "to_ship" && (
                              <button
                                onClick={() => markRefunded(item)}
                                disabled={loading}
                                className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-emerald-400/40 to-emerald-500/40 px-3 py-1 text-[11px] font-semibold text-slate-900 transition hover:from-emerald-300/60 hover:to-emerald-400/60 disabled:opacity-60"
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                Mark refunded
                              </button>
                            )}
                            <Link href={`/returns/${item.id}`} className="ml-auto text-[11px] font-semibold text-cyan-100 hover:text-white">
                              Details ↗
                            </Link>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
