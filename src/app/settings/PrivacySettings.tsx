"use client";

import { useEffect, useState } from "react";
import { useClerk } from "@clerk/nextjs";

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
  const [accountConfirm, setAccountConfirm] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const { signOut } = useClerk();

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

  // Deliberately typed confirmation rather than a browser confirm(): this is the one action on
  // the page that cannot be undone, and it removes the sign-in used to reach the page.
  async function deleteAccount() {
    setDeletingAccount(true);
    setAccountError(null);
    const res = await fetch("/api/data/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "account" }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setAccountError(body?.error ?? "Couldn't complete the deletion. Please try again.");
      setDeletingAccount(false);
      return;
    }

    // The Clerk user is already gone server-side; this clears the local session and leaves.
    await signOut({ redirectUrl: "/" });
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
            <p className="text-lg font-semibold text-white">Choose what PickMe scans</p>
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

      <div className="rounded-3xl border border-amber-200/30 bg-amber-500/10 p-5 shadow-xl shadow-black/30">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-amber-100">Delete data</p>
            <p className="text-lg font-semibold text-white">Wipe your data, keep your account</p>
            <p className="text-sm text-amber-100/80">
              Removes purchases, receipts, subscriptions, returns, notifications, and everything the
              Inunity app has synced — captured wallet events, cap usage, and your saved card setup.
              Your sign-in stays, so you can start over.
            </p>
          </div>
        </div>
        <div className="mt-3">
          <button
            className="rounded-full border border-amber-200/60 px-4 py-2 text-sm text-amber-50 hover:bg-amber-500/20 disabled:opacity-60"
            onClick={deleteData}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete my data"}
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-rose-200/30 bg-rose-500/10 p-5 shadow-xl shadow-black/30">
        <div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-rose-100">Delete account</p>
          <p className="text-lg font-semibold text-white">Delete your account permanently</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-rose-100/85">
            <li>Everything above is deleted, plus your account record itself.</li>
            <li>Your Inunity sign-in is removed. You will not be able to sign in again.</li>
            <li>Any Wallet Shortcut installation tokens stop working immediately.</li>
            <li>
              The Inunity iPhone app keeps working offline, but stops syncing. Data stored only on
              your iPhone is not touched by this — delete that in the app.
            </li>
            <li>This cannot be undone, and we cannot restore it for you.</li>
          </ul>
        </div>
        <div className="mt-4 space-y-3">
          <label className="block text-xs text-rose-100/80" htmlFor="confirm-delete-account">
            Type <span className="font-semibold text-white">DELETE</span> to confirm.
          </label>
          <input
            id="confirm-delete-account"
            value={accountConfirm}
            onChange={(event) => setAccountConfirm(event.target.value)}
            autoComplete="off"
            className="w-48 rounded-lg border border-rose-200/40 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-rose-100/40 focus:border-rose-200/80"
            placeholder="DELETE"
          />
          <div className="flex items-center gap-3">
            <button
              className="rounded-full border border-rose-200/60 bg-rose-500/20 px-4 py-2 text-sm font-semibold text-rose-50 hover:bg-rose-500/30 disabled:opacity-40"
              onClick={deleteAccount}
              disabled={deletingAccount || accountConfirm.trim() !== "DELETE"}
            >
              {deletingAccount ? "Deleting account…" : "Delete my account"}
            </button>
            {accountError ? <span className="text-xs text-rose-100">{accountError}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
