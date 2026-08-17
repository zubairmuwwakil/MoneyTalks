"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function AutomationHome() {
  const [connected, setConnected] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function loadStatus() {
    const res = await fetch("/api/gmail/status", { cache: "no-store" });
    const data = await res.json();
    setConnected(Boolean(data.connected));
    setNeedsReauth(Boolean(data.needsReauth));
    setEmail(data.emailAddress ?? null);
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function disconnect() {
    await fetch("/api/gmail/disconnect", { method: "POST" });
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

      setResult(
        `Imported ${data?.importedEmails} · already scanned ${data?.skipped} · suggestions ${data?.suggestionsCreated}`
      );
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-4">
      <div className="rounded-2xl border p-4">
        <div className="text-sm font-semibold">Connection</div>
        <div className="mt-1 text-sm opacity-70">
          {connected ? `Connected: ${email ?? "Gmail"}` : "Not connected"}
        </div>
        {!connected && needsReauth ? (
          <div className="mt-1 text-sm text-amber-700">
            Google didn&apos;t grant Gmail access — reconnect and tick the Gmail checkbox on the consent screen.
          </div>
        ) : null}

        <div className="mt-3 flex gap-2">
          {!connected ? (
            <a
              className="rounded-xl border px-3 py-2 text-sm hover:bg-neutral-50"
              href="/api/gmail/connect"
            >
              Connect Gmail
            </a>
          ) : (
            <button className="rounded-xl border px-3 py-2 text-sm hover:bg-neutral-50" onClick={disconnect}>
              Disconnect
            </button>
          )}

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
          {!connected ? <div className="text-sm opacity-60">Connect Gmail to scan.</div> : null}
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
