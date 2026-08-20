"use client";

import { useState, useTransition } from "react";
import { X, CalendarClock, Check, AlertCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMinorUnits } from "@/engine/money";
import { bulkUpdateCardRenewalDates } from "@/app/cards/actions";

export interface RenewalModalCardItem {
  id: string;
  nickname: string;
  issuer: string;
  network: string;
  annualFeeMinor: number;
  feeRebateMinor: number;
  feeMonthDay: string | null;
  feeCancelGraceDays: number;
}

const MONTHS = [
  { value: "01", label: "Jan (01)" },
  { value: "02", label: "Feb (02)" },
  { value: "03", label: "Mar (03)" },
  { value: "04", label: "Apr (04)" },
  { value: "05", label: "May (05)" },
  { value: "06", label: "Jun (06)" },
  { value: "07", label: "Jul (07)" },
  { value: "08", label: "Aug (08)" },
  { value: "09", label: "Sep (09)" },
  { value: "10", label: "Oct (10)" },
  { value: "11", label: "Nov (11)" },
  { value: "12", label: "Dec (12)" },
];

export function RenewalManagerModal({
  isOpen,
  onClose,
  cards,
}: {
  isOpen: boolean;
  onClose: () => void;
  cards: RenewalModalCardItem[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Local state for dates: cardId -> { month: string, day: string, graceDays: number }
  const [drafts, setDrafts] = useState<
    Record<string, { month: string; day: string; graceDays: number }>
  >(() => {
    const init: Record<string, { month: string; day: string; graceDays: number }> = {};
    for (const c of cards) {
      let m = "01";
      let d = "01";
      if (c.feeMonthDay) {
        const parts = c.feeMonthDay.split("-");
        if (parts.length === 2) {
          m = parts[0];
          d = parts[1];
        }
      }
      init[c.id] = {
        month: m,
        day: d,
        graceDays: c.feeCancelGraceDays || 30,
      };
    }
    return init;
  });

  if (!isOpen) return null;

  function updateDraft(cardId: string, field: "month" | "day" | "graceDays", value: string | number) {
    setDrafts((prev) => ({
      ...prev,
      [cardId]: {
        ...prev[cardId],
        [field]: value,
      },
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const entries = cards.map((c) => {
      const draft = drafts[c.id];
      const paddedDay = String(draft.day).padStart(2, "0");
      return {
        cardId: c.id,
        feeMonthDay: `${draft.month}-${paddedDay}`,
        feeCancelGraceDays: draft.graceDays,
      };
    });

    startTransition(async () => {
      const res = await bulkUpdateCardRenewalDates(entries);
      if (res.ok) {
        setSuccess(true);
        setTimeout(() => {
          setSuccess(false);
          onClose();
        }, 800);
      } else {
        setError(res.error || "Failed to update renewal dates");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in-0">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/80 px-6 py-4 bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <CalendarClock className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Manage Renewal Dates</h2>
              <p className="text-xs text-muted-foreground">
                Set renewal dates to track your grace window and recover annual fees
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 overflow-y-auto space-y-4 max-h-[60vh]">
            {error ? (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Most Canadian credit cards charge their annual fee on your account anniversary date. Enter the approximate renewal month and day.
            </p>

            <div className="divide-y divide-border/60 rounded-xl border border-border/80 overflow-hidden">
              {cards.map((c) => {
                const draft = drafts[c.id] ?? { month: "01", day: "01", graceDays: 30 };
                const fee = Math.max(0, c.annualFeeMinor - c.feeRebateMinor);

                return (
                  <div key={c.id} className="p-4 bg-card hover:bg-muted/30 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{c.nickname}</span>
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {c.network}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {c.issuer} · Fee {formatMinorUnits(fee, "CAD")}/yr
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <label className="text-[11px] text-muted-foreground">Renews:</label>
                        <select
                          value={draft.month}
                          onChange={(e) => updateDraft(c.id, "month", e.target.value)}
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:ring-1 focus:ring-ring"
                        >
                          {MONTHS.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={1}
                          max={31}
                          value={draft.day}
                          onChange={(e) => updateDraft(c.id, "day", e.target.value)}
                          className="h-8 w-14 rounded-md border border-input bg-background px-2 text-xs text-center focus:ring-1 focus:ring-ring tabular-nums"
                          placeholder="Day"
                          title="Day of month (1-31)"
                        />
                      </div>

                      <div className="flex items-center gap-1 pl-2 border-l border-border/60">
                        <label className="text-[11px] text-muted-foreground" title="Days after fee posts where cancellation refunds the fee">
                          Grace:
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={90}
                          value={draft.graceDays}
                          onChange={(e) => updateDraft(c.id, "graceDays", Number(e.target.value))}
                          className="h-8 w-14 rounded-md border border-input bg-background px-2 text-xs text-center focus:ring-1 focus:ring-ring tabular-nums"
                          title="Grace days (usually 30 days)"
                        />
                        <span className="text-[10px] text-muted-foreground">d</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border/80 px-6 py-4 bg-muted/20">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Sparkles className="size-3.5 text-amber-500" />
              <span>Calculates cancellation deadlines automatically</span>
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isPending} className="min-w-[90px]">
                {success ? (
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <Check className="size-3.5" /> Saved
                  </span>
                ) : isPending ? (
                  "Saving..."
                ) : (
                  "Save Dates"
                )}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
