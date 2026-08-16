"use client";

import useSWR from "swr";
import { useEffect, useState } from "react";
import Link from "next/link";

type Pref = {
  emailDigestEnabled: boolean;
  digestHourLocal: number;
  timezone: string;
  subLeadDays: number;
  returnLeadDays: number;
  billLeadDays: number;
  primaryEmail?: string | null;
  notifyOnDelivery: boolean;
  notifyOnRefundOverdue: boolean;
};

type PrefResponse = { preference: Pref };


function fetcher<T>(url: string): Promise<T> {
  return fetch(url).then(r => r.json() as Promise<T>);
}

export default function NotificationSettings() {
  const { data, isLoading, error, mutate } = useSWR<PrefResponse>(
    "/api/settings/notifications",
    (url: string) => fetcher<PrefResponse>(url)
  );
  const pref: Pref | undefined = data?.preference;

  const [saving, setSaving] = useState(false);
  const [demoStatus, setDemoStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const storageKey = "moneytalks-theme";

  const [imapLoading, setImapLoading] = useState(true);
  const [imapSaving, setImapSaving] = useState(false);
  const [imapError, setImapError] = useState<string | null>(null);
  const [imapForm, setImapForm] = useState({
    emailAddress: "",
    imapUser: "",
    imapPassword: "",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecure: true,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = (localStorage.getItem(storageKey) as "light" | "dark" | null) ?? "dark";
    setTheme(saved);
    applyTheme(saved);
  }, []);

  useEffect(() => {
    let active = true;
    async function loadImap() {
      setImapLoading(true);
      setImapError(null);
      try {
        const res = await fetch("/api/imap/credentials");
        if (!res.ok) throw new Error("Failed to load IMAP credentials");
        const json = await res.json();
        if (!active) return;
        const creds = json?.credentials;
        if (creds) {
          setImapForm(prev => ({
            ...prev,
            emailAddress: creds.emailAddress ?? "",
            imapUser: creds.imapUser ?? "",
            imapHost: creds.imapHost ?? prev.imapHost,
            imapPort: creds.imapPort ?? prev.imapPort,
            imapSecure: typeof creds.imapSecure === "boolean" ? creds.imapSecure : prev.imapSecure,
            imapPassword: "",
          }));
        }
      } catch (err) {
        console.error(err);
        if (active) setImapError("Unable to load IMAP settings.");
      } finally {
        if (active) setImapLoading(false);
      }
    }
    loadImap();
    return () => {
      active = false;
    };
  }, []);

  function applyTheme(next: "light" | "dark") {
    if (typeof document === "undefined") return;
    const cls = next === "light" ? "theme-light" : "theme-dark";
    document.body.classList.remove("theme-light", "theme-dark");
    document.body.classList.add(cls);
    localStorage.setItem(storageKey, next);
    setTheme(next);
  }


  async function save() {
    if (!pref) return;
    setSaving(true);
    try {
      await fetch("/api/settings/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pref),
      });
      await mutate();
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof Pref>(key: K, value: Pref[K]) {
    mutate(
      (prev?: PrefResponse) => ({
        preference: { ...(prev?.preference ?? pref!), [key]: value },
      }),
      { revalidate: false }
    );
  }

  function applyQuickLeadDays(days: number) {
    if (!pref) return;
    update("subLeadDays", days);
    update("returnLeadDays", days);
    update("billLeadDays", days);
  }

  async function generateDemoJobs() {
    setDemoStatus("running");
    try {
      const res = await fetch("/api/dev/seed", { method: "POST" });
      if (!res.ok) throw new Error("Seed failed");
      setDemoStatus("done");
    } catch (err) {
      console.error(err);
      setDemoStatus("error");
    }
  }

  async function saveImap() {
    setImapSaving(true);
    setImapError(null);
    try {
      const res = await fetch("/api/imap/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailAddress: imapForm.emailAddress || undefined,
          imapUser: imapForm.imapUser || undefined,
          imapPassword: imapForm.imapPassword || undefined,
          imapHost: imapForm.imapHost || undefined,
          imapPort: imapForm.imapPort || undefined,
          imapSecure: imapForm.imapSecure,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || "Failed to save IMAP settings");
      }
    } catch (err) {
      console.error(err);
      setImapError(err instanceof Error ? err.message : "Failed to save IMAP settings");
    } finally {
      setImapSaving(false);
      setImapForm(prev => ({ ...prev, imapPassword: "" }));
    }
  }

  if (isLoading) return <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">Loading…</div>;
  if (error || !pref) return <div className="rounded-2xl border border-rose-200/40 bg-rose-500/10 p-4 text-sm text-rose-50">Failed to load settings.</div>;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/30">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-emerald-100">Weekly digest</p>
              <p className="text-lg font-semibold text-white">Bundle reminders into one beautiful email.</p>
              <p className="text-sm text-slate-300">Lead times, upcoming renewals, and returns in a single digest.</p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-100">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={pref.emailDigestEnabled}
                onChange={(e) => update("emailDigestEnabled", e.target.checked)}
              />
              <span>{pref.emailDigestEnabled ? "On" : "Off"}</span>
            </label>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="block text-sm">
              <div className="mb-1 text-slate-300">Send digest at (local time)</div>
              <input
                type="number"
                min={0}
                max={23}
                className="w-full rounded-xl border px-3 py-2 text-sm"
                value={pref.digestHourLocal}
                onChange={(e) => update("digestHourLocal", Number(e.target.value))}
              />
            </label>
            <label className="block text-sm">
              <div className="mb-1 text-slate-300">Primary email</div>
              <input
                className="w-full rounded-xl border px-3 py-2 text-sm"
                value={pref.primaryEmail ?? ""}
                onChange={(e) => update("primaryEmail", e.target.value)}
                placeholder="you@example.com"
              />
            </label>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Digest preview</p>
              <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] text-emerald-100">Sample</span>
            </div>
            <div className="mt-3 space-y-2 text-sm text-slate-200">
              <div className="flex items-center justify-between">
                <span>Return by Jan 18 — 4 days left</span>
                <span className="rounded-full bg-cyan-500/20 px-2 py-1 text-[11px] text-cyan-50">Return</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Adobe CC · Renews in 3 days</span>
                <span className="rounded-full bg-emerald-500/20 px-2 py-1 text-[11px] text-emerald-50">Subscription</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Spotify · Renews Jan 22</span>
                <span className="rounded-full bg-indigo-500/20 px-2 py-1 text-[11px] text-indigo-50">Autopay</span>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/30 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Appearance</p>
              <p className="text-sm text-slate-200">Light/dark + motion preference (UI only).</p>
            </div>
            <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] text-white">UI</span>
          </div>
          <div className="space-y-2 text-sm text-slate-100">
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <span>Theme</span>
              <div className="flex items-center gap-2">
                {(["dark", "light"] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => applyTheme(mode)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      theme === mode ? "bg-white/15 text-white" : "bg-white/5 text-slate-300 hover:text-white"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <span>Reduced motion</span>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-100">
                <input type="checkbox" />
                Respect system
              </label>
            </div>
            <Link href="/" className="text-[11px] font-semibold text-cyan-100 hover:text-white">
              Appearance controls are UI-only for now.
            </Link>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/30 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-100">IMAP inbox</p>
            <p className="text-lg font-semibold text-white">Connect any IMAP mailbox for scanning.</p>
            <p className="text-sm text-slate-300">Stored per user. For Gmail, use an app password or OAuth token.</p>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] text-slate-100">{imapLoading ? "Loading…" : "Ready"}</span>
        </div>
        {imapError && <div className="rounded-xl border border-rose-200/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-50">{imapError}</div>}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            <div className="mb-1 text-slate-300">Email address</div>
            <input
              className="w-full rounded-xl border px-3 py-2 text-sm"
              value={imapForm.emailAddress}
              onChange={(e) => setImapForm(f => ({ ...f, emailAddress: e.target.value }))}
              placeholder="you@example.com"
            />
          </label>
          <label className="block text-sm">
            <div className="mb-1 text-slate-300">IMAP username</div>
            <input
              className="w-full rounded-xl border px-3 py-2 text-sm"
              value={imapForm.imapUser}
              onChange={(e) => setImapForm(f => ({ ...f, imapUser: e.target.value }))}
              placeholder="usually the same as email"
            />
          </label>
          <label className="block text-sm">
            <div className="mb-1 text-slate-300">Password / app password</div>
            <input
              type="password"
              className="w-full rounded-xl border px-3 py-2 text-sm"
              value={imapForm.imapPassword}
              onChange={(e) => setImapForm(f => ({ ...f, imapPassword: e.target.value }))}
              placeholder="not returned after save"
            />
          </label>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <label className="col-span-2">
              <div className="mb-1 text-slate-300">IMAP host</div>
              <input
                className="w-full rounded-xl border px-3 py-2 text-sm"
                value={imapForm.imapHost}
                onChange={(e) => setImapForm(f => ({ ...f, imapHost: e.target.value }))}
                placeholder="imap.gmail.com"
              />
            </label>
            <label>
              <div className="mb-1 text-slate-300">Port</div>
              <input
                type="number"
                className="w-full rounded-xl border px-3 py-2 text-sm"
                value={imapForm.imapPort}
                onChange={(e) => setImapForm(f => ({ ...f, imapPort: Number(e.target.value) }))}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={imapForm.imapSecure}
              onChange={(e) => setImapForm(f => ({ ...f, imapSecure: e.target.checked }))}
            />
            <span className="text-slate-200">Use TLS (recommended)</span>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={saveImap}
            disabled={imapSaving}
            className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-emerald-200/50 hover:bg-white/10 disabled:opacity-60"
          >
            {imapSaving ? "Saving…" : "Save IMAP settings"}
          </button>
          <p className="text-xs text-slate-400">We never return your password once saved.</p>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/30 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-100">Reminder lead times</p>
            <p className="text-lg font-semibold text-white">Choose when to nudge before deadlines.</p>
            <p className="text-sm text-slate-300">Subscriptions, returns, and bills share the cadence.</p>
          </div>
          <div className="hidden md:flex gap-2">
            {[1, 3, 7, 14].map((d) => (
              <button
                key={d}
                onClick={() => applyQuickLeadDays(d)}
                className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-100 transition hover:border-emerald-200/50 hover:bg-white/10"
              >
                {d} day{d === 1 ? "" : "s"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            <div className="mb-1 text-slate-300">Subscriptions</div>
            <input
              type="number"
              min={0}
              max={31}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              value={pref.subLeadDays}
              onChange={(e) => update("subLeadDays", Number(e.target.value))}
            />
          </label>
          <label className="block text-sm">
            <div className="mb-1 text-slate-300">Returns</div>
            <input
              type="number"
              min={0}
              max={31}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              value={pref.returnLeadDays}
              onChange={(e) => update("returnLeadDays", Number(e.target.value))}
            />
          </label>
          <label className="block text-sm">
            <div className="mb-1 text-slate-300">Bills</div>
            <input
              type="number"
              min={0}
              max={31}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              value={pref.billLeadDays}
              onChange={(e) => update("billLeadDays", Number(e.target.value))}
            />
          </label>
        </div>
        <div className="md:hidden flex flex-wrap gap-2">
          {[1, 3, 7, 14].map((d) => (
            <button
              key={d}
              onClick={() => applyQuickLeadDays(d)}
              className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-100 transition hover:border-emerald-200/50 hover:bg-white/10"
            >
              {d} day{d === 1 ? "" : "s"}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/30 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-100">Delivery + refunds</p>
            <p className="text-lg font-semibold text-white">Shipment arrived? Refund missing?</p>
            <p className="text-sm text-slate-300">Control alerts for delivered packages and overdue refunds.</p>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] text-slate-100">Returns</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100">
            <span>Notify when delivered</span>
            <input
              type="checkbox"
              checked={pref.notifyOnDelivery}
              onChange={(e) => update("notifyOnDelivery", e.target.checked)}
            />
          </label>
          <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100">
            <span>Notify when refund overdue</span>
            <input
              type="checkbox"
              checked={pref.notifyOnRefundOverdue}
              onChange={(e) => update("notifyOnRefundOverdue", e.target.checked)}
            />
          </label>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/30 space-y-2 lg:col-span-2">
          <div className="text-sm font-semibold text-white">Demo mode</div>
          <p className="text-sm text-slate-300">Generate sample notification jobs for the next 7 days.</p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={generateDemoJobs}
              disabled={demoStatus === "running"}
              className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-emerald-200/50 hover:bg-white/10 disabled:opacity-60"
            >
              {demoStatus === "running" ? "Generating…" : "Generate Demo Jobs"}
            </button>
            {demoStatus === "done" && <span className="text-xs font-semibold text-emerald-100">Demo jobs created.</span>}
            {demoStatus === "error" && <span className="text-xs font-semibold text-rose-100">Demo job creation failed.</span>}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/30 space-y-2">
          <div className="text-sm font-semibold text-white">Save changes</div>
          <p className="text-sm text-slate-300">Persist your preferences to start using them right away.</p>
          <button
            className="mt-2 w-full rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-emerald-200/50 hover:bg-white/10 disabled:opacity-60"
            onClick={save}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </div>
    </div>
  );
}
