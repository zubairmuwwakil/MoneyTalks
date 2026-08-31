"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Coins, Sparkles } from "lucide-react";

import { formatCurrencyCodeAmount } from "@/lib/utils/currency";

type Reason = { code: string | null; detail: string };
type Evidence = {
  id: string;
  occurredAt: string;
  role: string;
  excludedByUser: boolean;
};
type ScheduleEntry = { from: string; to?: string; amountMinor: number };
type RecurringObligation = {
  id: string;
  merchantCanonicalId: string;
  currency: string | null;
  cadence: Record<string, unknown>;
  schedule: ScheduleEntry[];
  amountPattern: string;
  status: string | null;
  nextExpectedDate: string | null;
  reasons: Reason[];
  evidence: Evidence[];
};

type Dismissal = { reason: string; detail: string };
type CurrencyNeed = {
  merchantCanonicalId: string;
  cadence: Record<string, unknown>;
  evidence: Array<{ id: string; occurredAt: string }>;
};

const selectStyle = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800";
const secondaryButton = "rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60";

function cadenceInWords(cadence: Record<string, unknown>): string {
  switch (cadence.type) {
    case "WEEKLY": return "Every week";
    case "BIWEEKLY": return "Every two weeks";
    case "MONTHLY": return typeof cadence.dayOfMonth === "number" ? `Monthly, around day ${cadence.dayOfMonth}` : "Every month";
    case "QUARTERLY": return "Every three months";
    case "SEMIANNUAL": return "Every six months";
    case "ANNUAL": return "Every year";
    default: return "Cadence not established";
  }
}

function amountInWords(obligation: RecurringObligation): string {
  const entries = Array.isArray(obligation.schedule) ? obligation.schedule : [];
  const latest = [...entries].sort((a, b) => b.from.localeCompare(a.from))[0];
  if (!latest || typeof latest.amountMinor !== "number") return "Amount not stated";
  const amount = formatCurrencyCodeAmount(latest.amountMinor, obligation.currency);
  if (obligation.amountPattern === "FIXED") return amount;
  return `${amount} most recently · amount varies`;
}

function dateInWords(value: string): string {
  return new Date(value).toLocaleDateString("en-CA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function dismissalReason(value: Dismissal | undefined): string | null {
  if (!value?.reason) return null;
  if (value.reason !== "other") return value.reason;
  const detail = value.detail.trim();
  return detail ? `other: ${detail}` : null;
}

export default function RecurringObligationReview() {
  const [obligations, setObligations] = useState<RecurringObligation[]>([]);
  const [currencyNeeds, setCurrencyNeeds] = useState<CurrencyNeed[]>([]);
  const [dismissals, setDismissals] = useState<Record<string, Dismissal>>({});
  const [currencies, setCurrencies] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/recurring?view=review", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load recurring obligations");
      const data = await response.json();
      setObligations(data.obligations ?? []);
      setCurrencyNeeds(data.currencyNeeds ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load recurring obligations");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/recurring/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Could not save that decision");
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that decision");
    } finally {
      setBusyId(null);
    }
  }

  async function teachCurrencyNeed(merchantCanonicalId: string, currency: string) {
    const busyKey = `currency-needed:${merchantCanonicalId}`;
    setBusyId(busyKey);
    setError(null);
    try {
      const response = await fetch("/api/recurring/currency", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantCanonicalId, currency }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Could not save that currency");
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that currency");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <div className="rounded-2xl border bg-white/80 p-6 text-sm text-slate-600">Loading recurring obligations…</div>;
  }

  return (
    <section className="space-y-4" aria-labelledby="recurring-review-heading">
      <div className="rounded-2xl border bg-white/80 p-6 shadow-sm">
        <h2 id="recurring-review-heading" className="text-xl font-semibold text-slate-900">Recurring obligations to review</h2>
        <p className="mt-1 text-sm text-slate-600">Confirm or dismiss each detection. Owner-created obligations remain canonical and unchanged.</p>
      </div>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}

      {currencyNeeds.length > 0 ? (
        <section className="space-y-4" aria-labelledby="currency-needed-heading">
          <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 id="currency-needed-heading" className="text-base font-semibold text-amber-950 flex items-center gap-2">
                <Sparkles className="size-4 text-amber-700" />
                Currency needed to check recurrence
              </h3>
              <p className="mt-1 text-sm text-amber-900">
                These purchases recur on a schedule, but their receipts did not state a currency.
              </p>
            </div>
            <Link
              href="/settings/merchants?tab=currencies"
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-amber-950 transition hover:bg-amber-100/50 shadow-2xs whitespace-nowrap self-start sm:self-auto"
            >
              <Coins className="size-3.5" />
              <span>Review all merchants</span>
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
          {currencyNeeds.map((need) => {
            const currency = currencies[need.merchantCanonicalId] ?? "";
            const busyKey = `currency-needed:${need.merchantCanonicalId}`;
            const disabled = busyId === busyKey;
            return (
              <article key={need.merchantCanonicalId} className="space-y-3 rounded-2xl border border-amber-200 bg-white/80 p-5 shadow-sm">
                <div>
                  <h4 className="text-base font-semibold text-slate-900">{need.merchantCanonicalId}</h4>
                  <p className="mt-1 text-sm text-slate-600">{cadenceInWords(need.cadence)} pattern in {need.evidence.length} purchases.</p>
                  <p className="mt-1 text-xs text-slate-500">{need.evidence.map(({ occurredAt }) => dateInWords(occurredAt)).join(" · ")}</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <label className="text-sm font-medium text-slate-700" htmlFor={`currency-needed-${need.merchantCanonicalId}`}>Billing currency</label>
                  <input
                    id={`currency-needed-${need.merchantCanonicalId}`}
                    className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm uppercase text-slate-800"
                    aria-label={`Billing currency for ${need.merchantCanonicalId}`}
                    autoCapitalize="characters"
                    maxLength={3}
                    placeholder="USD"
                    value={currency}
                    onChange={(event) => setCurrencies((current) => ({
                      ...current,
                      [need.merchantCanonicalId]: event.target.value.toUpperCase(),
                    }))}
                  />
                  <button
                    className={secondaryButton}
                    onClick={() => teachCurrencyNeed(need.merchantCanonicalId, currency)}
                    disabled={disabled || !/^[A-Z]{3}$/.test(currency)}
                  >
                    Check this recurrence
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      {obligations.length === 0 && currencyNeeds.length === 0 ? (
        <div className="rounded-2xl border bg-white/80 p-4 text-sm text-slate-600">No recurring obligations need review.</div>
      ) : obligations.map((obligation) => {
        const dismissal = dismissals[obligation.id] ?? { reason: "", detail: "" };
        const currency = currencies[obligation.id] ?? "";
        const reason = dismissalReason(dismissal);
        const disabled = busyId === obligation.id;
        const explanation = obligation.reasons.map((item) => item.detail).join(" ");

        return (
          <article key={obligation.id} className="space-y-4 rounded-2xl border bg-white/80 p-5 shadow-sm">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div>
                <h3 className="text-base font-semibold text-slate-900">{obligation.merchantCanonicalId}</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {cadenceInWords(obligation.cadence)} · {amountInWords(obligation)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {obligation.status ? obligation.status.toLowerCase() : "status unavailable"}
                  {obligation.nextExpectedDate ? ` · next expected ${dateInWords(obligation.nextExpectedDate)}` : ""}
                </p>
              </div>
              <button
                className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                onClick={() => patch(obligation.id, { action: "confirm" })}
                disabled={disabled}
              >
                Yes, this recurs
              </button>
            </div>

            {explanation ? (
              <p className="rounded-xl bg-cyan-50 px-4 py-3 text-sm leading-6 text-cyan-950">{explanation}</p>
            ) : (
              <p className="text-sm text-slate-500">No explanation was stored for this suggestion.</p>
            )}

            <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center">
              <label className="text-sm font-medium text-slate-700" htmlFor={`currency-${obligation.id}`}>Billing currency</label>
              <input
                id={`currency-${obligation.id}`}
                className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm uppercase text-slate-800"
                aria-label={`Billing currency for ${obligation.merchantCanonicalId}`}
                autoCapitalize="characters"
                maxLength={3}
                placeholder="USD"
                value={currency}
                onChange={(event) => setCurrencies((current) => ({
                  ...current,
                  [obligation.id]: event.target.value.toUpperCase(),
                }))}
              />
              <button
                className={secondaryButton}
                onClick={() => patch(obligation.id, { action: "set-currency", currency })}
                disabled={disabled || !/^[A-Z]{3}$/.test(currency)}
              >
                Teach this merchant
              </button>
              <p className="text-xs text-slate-500">Applies only to your purchases from this merchant; message-specific currency evidence still wins.</p>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence dates</h4>
              <ul className="mt-2 flex flex-wrap gap-2">
                {obligation.evidence.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
                    <span>{dateInWords(item.occurredAt)}</span>
                    <span className="text-slate-400">{item.role.toLowerCase().replaceAll("_", " ")}</span>
                    <button
                      className="font-semibold text-slate-600 underline decoration-slate-300 underline-offset-2 disabled:no-underline"
                      onClick={() => patch(obligation.id, { action: "exclude-evidence", evidenceId: item.id })}
                      disabled={disabled || item.excludedByUser}
                    >
                      {item.excludedByUser ? "Excluded" : "Exclude"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center">
              <label className="text-sm font-medium text-slate-700" htmlFor={`dismiss-${obligation.id}`}>Not useful because</label>
              <select
                id={`dismiss-${obligation.id}`}
                className={selectStyle}
                value={dismissal.reason}
                onChange={(event) => setDismissals((current) => ({
                  ...current,
                  [obligation.id]: { ...dismissal, reason: event.target.value },
                }))}
              >
                <option value="">Choose a reason</option>
                <option value="not-recurring">This is not recurring</option>
                <option value="duplicate">This is a duplicate</option>
                <option value="not-interested">I do not track this merchant</option>
                <option value="other">Something else</option>
              </select>
              {dismissal.reason === "other" ? (
                <input
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  aria-label="Other dismissal reason"
                  maxLength={190}
                  placeholder="Tell us why"
                  value={dismissal.detail}
                  onChange={(event) => setDismissals((current) => ({
                    ...current,
                    [obligation.id]: { ...dismissal, detail: event.target.value },
                  }))}
                />
              ) : null}
              <button
                className={secondaryButton}
                onClick={() => patch(obligation.id, { action: "dismiss", dismissReason: reason })}
                disabled={disabled || !reason}
              >
                Dismiss
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
