"use client";

import { useEffect, useState } from "react";

type GmailStatus = {
  connected: boolean;
  needsReauth: boolean;
  emailAddress: string | null;
  scope?: string | null;
  scanMode?: "ALL" | "RECEIPTS_ONLY" | "SHIPPING_ONLY" | "SUBSCRIPTIONS_ONLY";
  lastScanAt?: string | null;
};

type Summary = {
  purchases: number;
  purchaseItems: number;
  purchaseAttachments: number;
  returns: number;
  subscriptions: number;
  subscriptionPayments: number;
  bills: number;
  emailConnections: number;
  emailTransactions: number;
  receiptUploads: number;
  receiptDocuments: number;
  detectedItems: number;
  automationSuggestions: number;
  notifications: number;
  notificationJobs: number;
  notificationPreferences: number;
  snoozedEvents: number;
  shipmentEvents: number;
  refundCases: number;
  valueEvents: number;
};

export default function PrivacySettings() {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [scanMode, setScanMode] = useState<GmailStatus["scanMode"]>("ALL");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const [statusRes, summaryRes] = await Promise.all([
      fetch("/api/gmail/status", { cache: "no-store" }),
      fetch("/api/data/summary", { cache: "no-store" }),
    ]);
    const statusJson = await statusRes.json();
    const summaryJson = await summaryRes.json();
    setStatus(statusJson);
    setSummary(summaryJson);
    setScanMode(statusJson.scanMode ?? "ALL");
  }

  useEffect(() => {
    let active = true;
    (async () => {
      if (!active) return;
      await load();
    })();
    return () => {
      active = false;
    };
  }, []);

  async function saveScanMode() {
    setSaving(true);
    setMessage(null);
    await fetch("/api/gmail/scan-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanMode }),
    });
    setSaving(false);
    setMessage("Scan mode saved");
    await load();
  }

  async function deleteData() {
    const ok = confirm("This will delete your stored data. Continue?");
    if (!ok) return;
    setDeleting(true);
    setMessage(null);
    const res = await fetch("/api/data/delete", { method: "POST" });
    if (!res.ok) {
      setMessage("Failed to delete data");
    } else {
      setMessage("Deletion job started");
    }
    setDeleting(false);
    await load();
  }

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/30">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Connected accounts</p>
            <p className="text-lg font-semibold text-white">Email access</p>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] text-white">
            {status?.connected ? "Connected" : "Not connected"}
          </span>
        </div>
        <div className="mt-3 text-sm text-slate-300">
          {status?.emailAddress ? `Email: ${status.emailAddress}` : "No connected account"}
        </div>
        <div className="mt-2 text-xs text-slate-400">
          Scopes: {status?.scope ?? "—"}
        </div>
        <div className="mt-2 text-xs text-slate-400">
          Last scan: {status?.lastScanAt ? new Date(status.lastScanAt).toLocaleString() : "—"}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/30">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-100">Scan modes</p>
            <p className="text-lg font-semibold text-white">Choose what MoneyTalks scans</p>
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-sm text-slate-200">
          <label className="flex items-center gap-2">
            <input type="radio" name="scanMode" checked={scanMode === "ALL"} onChange={() => setScanMode("ALL")} />
            <span>All</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="scanMode" checked={scanMode === "RECEIPTS_ONLY"} onChange={() => setScanMode("RECEIPTS_ONLY")} />
            <span>Receipts only</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="scanMode" checked={scanMode === "SHIPPING_ONLY"} onChange={() => setScanMode("SHIPPING_ONLY")} />
            <span>Shipping only</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="scanMode" checked={scanMode === "SUBSCRIPTIONS_ONLY"} onChange={() => setScanMode("SUBSCRIPTIONS_ONLY")} />
            <span>Subscriptions only</span>
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            className="rounded-full border px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-60"
            onClick={saveScanMode}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save scan mode"}
          </button>
          {message ? <span className="text-xs text-emerald-200">{message}</span> : null}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/30">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-emerald-100">Your data</p>
            <p className="text-lg font-semibold text-white">Summary + export</p>
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-sm text-slate-300 md:grid-cols-2">
          <div>Purchases: {summary?.purchases ?? 0}</div>
          <div>Returns: {summary?.returns ?? 0}</div>
          <div>Subscriptions: {summary?.subscriptions ?? 0}</div>
          <div>Subscription payments: {summary?.subscriptionPayments ?? 0}</div>
          <div>Bills: {summary?.bills ?? 0}</div>
          <div>Email connections: {summary?.emailConnections ?? 0}</div>
          <div>Email transactions: {summary?.emailTransactions ?? 0}</div>
          <div>Receipt uploads: {summary?.receiptUploads ?? 0}</div>
          <div>Shipment events: {summary?.shipmentEvents ?? 0}</div>
          <div>Refund cases: {summary?.refundCases ?? 0}</div>
          <div>Notifications: {summary?.notifications ?? 0}</div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <a
            href="/api/data/export"
            className="rounded-full border px-4 py-2 text-sm hover:bg-white/10"
          >
            Export JSON
          </a>
        </div>
      </div>

      <div className="rounded-3xl border border-rose-200/30 bg-rose-500/10 p-5 shadow-xl shadow-black/30">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-rose-100">Delete data</p>
            <p className="text-lg font-semibold text-white">Wipe your data</p>
            <p className="text-sm text-rose-100/80">This removes purchases, receipts, subscriptions, returns, and notifications.</p>
          </div>
        </div>
        <div className="mt-3">
          <button
            className="rounded-full border border-rose-200/60 px-4 py-2 text-sm text-rose-50 hover:bg-rose-500/20 disabled:opacity-60"
            onClick={deleteData}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete my data"}
          </button>
        </div>
      </div>
    </div>
  );
}
