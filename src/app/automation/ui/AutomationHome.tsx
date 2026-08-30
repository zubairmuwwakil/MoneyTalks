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
  backfillRequestedAt: string | null;
  backfillCompletedAt: string | null;
  monthsCovered: number;
  monthsTarget: number;
  backfillComplete: boolean;
};

type BackfillProgress = {
  connectionId: string;
  requestedAt: string | null;
  completedAt: string | null;
  monthsCovered: number;
  monthsTarget: number;
  complete: boolean;
};

export default function AutomationHome() {
  const [connections, setConnections] = useState<GmailConnectionStatus[]>([]);
  const [scanning, setScanning] = useState(false);
  const [requestingBackfill, setRequestingBackfill] = useState<string | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const connected = connections.some((connection) => connection.connected);

  async function loadStatus() {
    const [statusResponse, backfillResponse] = await Promise.all([
      fetch("/api/gmail/status", { cache: "no-store" }),
      fetch("/api/gmail/backfill", { cache: "no-store" }),
    ]);
    const [status, backfill] = await Promise.all([statusResponse.json(), backfillResponse.json()]);
    const progressByConnection = new Map<string, BackfillProgress>(
      (Array.isArray(backfill.connections) ? backfill.connections : [])
        .map((progress: BackfillProgress) => [progress.connectionId, progress]),
    );
    const statuses = Array.isArray(status.connections) ? status.connections : [];
    setConnections(statuses.map((connection: Omit<GmailConnectionStatus,
      "backfillRequestedAt" | "backfillCompletedAt" | "monthsCovered" | "monthsTarget" | "backfillComplete"
    >) => {
      const progress = progressByConnection.get(connection.id);
      return {
        ...connection,
        backfillRequestedAt: progress?.requestedAt ?? null,
        backfillCompletedAt: progress?.completedAt ?? null,
        monthsCovered: progress?.monthsCovered ?? 0,
        monthsTarget: progress?.monthsTarget ?? 24,
        backfillComplete: progress?.complete ?? false,
      };
    }));
  }

  useEffect(() => {
    loadStatus();
    const timer = window.setInterval(loadStatus, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  async function requestBackfill(connectionId: string) {
    setRequestingBackfill(connectionId);
    setBackfillError(null);
    try {
      const response = await fetch("/api/gmail/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Could not start the historical scan");
      }
      await loadStatus();
    } catch (error) {
      setBackfillError(error instanceof Error ? error.message : String(error));
    } finally {
      setRequestingBackfill(null);
    }
  }

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

              <div className="mt-4 border-t pt-4">
                <div className="text-sm font-semibold">Find my subscriptions</div>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed opacity-70">
                  We&apos;ll scan up to two years of receipt-shaped emails from this mailbox to spot recurring
                  charges, including annual renewals that a recent scan cannot find.
                </p>

                {connection.backfillComplete ? (
                  <div className="mt-3 text-xs font-medium text-emerald-700">
                    Historical scan complete · {connection.monthsTarget} months covered
                  </div>
                ) : connection.backfillRequestedAt ? (
                  <div className="mt-3 max-w-sm" aria-live="polite">
                    <div className="flex items-center justify-between text-xs">
                      <span>Scanning history…</span>
                      <span>{connection.monthsCovered} / {connection.monthsTarget} months</span>
                    </div>
                    <div
                      className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={connection.monthsTarget}
                      aria-valuenow={connection.monthsCovered}
                    >
                      <div
                        className="h-full rounded-full bg-cyan-600 transition-[width]"
                        style={{
                          width: `${Math.min(100, (connection.monthsCovered / connection.monthsTarget) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <button
                    className="mt-3 rounded-lg border border-cyan-700/30 bg-cyan-700 px-3 py-2 text-xs font-medium text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => requestBackfill(connection.id)}
                    disabled={connection.needsReauth || requestingBackfill === connection.id}
                  >
                    {requestingBackfill === connection.id ? "Starting…" : "Scan two years of receipts"}
                  </button>
                )}
              </div>
            </div>
          ))}
          {backfillError ? <div className="text-xs text-red-700">Historical scan: {backfillError}</div> : null}
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
