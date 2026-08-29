"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ScanMode = "ALL" | "RECEIPTS_ONLY" | "SHIPPING_ONLY" | "SUBSCRIPTIONS_ONLY";

type GmailConnectionStatus = {
  id: string;
  emailAddress: string;
  connected: boolean;
  needsReauth: boolean;
  gmailScopeGranted: boolean;
  scanMode: ScanMode;
  lastScanAt: string | null;
  lastScanError: string | null;
};

export default function AutomationHome() {
  const [connections, setConnections] = useState<GmailConnectionStatus[]>([]);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const connected = connections.some((connection) => connection.connected);

  async function loadStatus() {
    const res = await fetch("/api/gmail/status", { cache: "no-store" });
    const data = await res.json();
    setConnections(Array.isArray(data.connections) ? data.connections : []);
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function disconnect(connectionId: string) {
    await fetch("/api/gmail/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId }),
    });
    await loadStatus();
  }

  async function saveScanMode(connectionId: string, scanMode: ScanMode) {
    await fetch("/api/gmail/scan-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId, scanMode }),
    });
    await loadStatus();
  }

  async function scanNow() {
    setScanning(true);
    setResult(null);

    try {
      const res = await fetch("/api/automation/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 90, max: 100 }),
      });

      const text = await res.text();
      let data: Record<string, unknown> | null = null;
      try {
        data = JSON.parse(text);
      } catch {
        // not JSON
      }

      if (!res.ok) {
        setResult(String(data?.error ?? text ?? "Scan failed"));
        return;
      }

      const failures = Array.isArray(data?.perConnection)
        ? data.perConnection.filter((connection: { error?: string }) => connection.error).length
        : 0;
      setResult(
        `Imported ${data?.importedEmails} · already scanned ${data?.skipped} · suggestions ${data?.suggestionsCreated}`
        + (failures ? ` · ${failures} mailbox${failures === 1 ? "" : "es"} failed` : ""),
      );
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-4">
      <div className="rounded-2xl border p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">Connected mailboxes</div>
          <a className="rounded-xl border px-3 py-2 text-sm hover:bg-neutral-50" href="/api/gmail/connect">
            {connections.length === 0 ? "Connect Gmail" : "Connect another account"}
          </a>
        </div>

        <div className="mt-3 space-y-3">
          {connections.length === 0 ? <div className="text-sm opacity-70">No connected account</div> : null}
          {connections.map((connection) => (
            <div key={connection.id} className="rounded-xl border bg-white/40 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{connection.emailAddress}</div>
                  <div className="text-xs opacity-60">
                    Last scan: {connection.lastScanAt ? new Date(connection.lastScanAt).toLocaleString() : "Never"}
                  </div>
                  {connection.lastScanError ? (
                    <div className="mt-1 text-xs text-red-700">Last scan failed: {connection.lastScanError}</div>
                  ) : null}
                  {connection.needsReauth ? (
                    <div className="mt-1 text-xs text-amber-700">
                      Reconnect this mailbox and grant Gmail read access.
                    </div>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  {connection.needsReauth ? (
                    <a className="rounded-lg border px-2.5 py-1.5 text-xs hover:bg-neutral-50" href="/api/gmail/connect">
                      Reconnect
                    </a>
                  ) : null}
                  <button
                    className="rounded-lg border px-2.5 py-1.5 text-xs hover:bg-neutral-50"
                    onClick={() => disconnect(connection.id)}
                  >
                    Disconnect
                  </button>
                </div>
              </div>
              <label className="mt-3 flex items-center gap-2 text-xs">
                <span className="opacity-70">Scan mode</span>
                <select
                  className="rounded-lg border bg-white px-2 py-1"
                  value={connection.scanMode}
                  onChange={(event) => saveScanMode(connection.id, event.target.value as ScanMode)}
                >
                  <option value="ALL">All</option>
                  <option value="RECEIPTS_ONLY">Receipts only</option>
                  <option value="SHIPPING_ONLY">Shipping only</option>
                  <option value="SUBSCRIPTIONS_ONLY">Subscriptions only</option>
                </select>
              </label>
            </div>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-neutral-50" href="/settings/automation/detected">
            Detected
          </Link>
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-neutral-50" href="/settings/automation/review">
            Inbox Review
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border p-4">
        <div className="text-sm font-semibold">Scan</div>
        <div className="mt-2 text-sm opacity-70">Scans last 90 days. Nothing is created until you confirm.</div>

        <div className="mt-3 flex items-center gap-3">
          <button
            className="rounded-xl border px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-60"
            onClick={scanNow}
            disabled={!connected || scanning}
          >
            {scanning ? "Scanning…" : "Scan now"}
          </button>

          {result ? <div className="text-sm opacity-70">{result}</div> : null}
          {!connected ? <div className="text-sm opacity-60">Connect or reauthorize Gmail to scan.</div> : null}
        </div>
      </div>

      <div className="rounded-2xl border p-4">
        <div className="text-sm font-semibold">Privacy-first</div>
        <ul className="mt-2 text-sm opacity-70 list-disc pl-5 space-y-1">
          <li>You confirm every suggestion</li>
          <li>Disconnect anytime</li>
        </ul>
      </div>
    </div>
  );
}
