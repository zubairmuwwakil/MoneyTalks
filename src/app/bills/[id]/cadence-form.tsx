"use client";

import { useState } from "react";
import type { Cadence } from "@/engine/recurrence";
import { Button } from "@/components/ui/button";

const inputStyle =
  "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring";
const labelStyle = "block text-xs font-medium text-foreground mb-1";

export function CadenceForm({
  billId,
  initialCadence,
  action,
  error,
}: {
  billId: string;
  initialCadence: Cadence;
  action: (formData: FormData) => Promise<void>;
  error?: string;
}) {
  const [type, setType] = useState<string>(initialCadence.type);
  const [dayOfMonth, setDayOfMonth] = useState<number>(
    initialCadence.type === "MONTHLY" ? initialCadence.dayOfMonth : 1,
  );
  const [startsFrom, setStartsFrom] = useState<string>(
    initialCadence.type === "MONTHLY" ? (initialCadence.startsFrom ?? "") : "",
  );
  const [anchor, setAnchor] = useState<string>(
    initialCadence.type !== "MONTHLY" ? initialCadence.anchor : "",
  );
  const [isOpen, setIsOpen] = useState(false);

  const formatSummary = (c: Cadence) => {
    switch (c.type) {
      case "MONTHLY":
        return `Monthly on day ${c.dayOfMonth}${c.startsFrom ? ` (starts from ${c.startsFrom})` : ""}`;
      case "BIWEEKLY":
        return `Biweekly (every 14 days, anchored to ${c.anchor})`;
      case "QUARTERLY":
        return `Quarterly (every 3 months, anchored to ${c.anchor})`;
      case "ANNUAL":
        return `Annual (every 12 months, anchored to ${c.anchor})`;
    }
  };

  const cadenceObj =
    type === "MONTHLY"
      ? { type, dayOfMonth: Number(dayOfMonth), ...(startsFrom ? { startsFrom } : {}) }
      : { type, anchor };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">
          Current schedule: <span className="font-semibold">{formatSummary(initialCadence)}</span>
        </p>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? "Cancel" : "Change cadence"}
        </Button>
      </div>

      {isOpen ? (
        <form action={action} className="mt-3 rounded-lg border border-border/80 bg-muted/20 p-4 space-y-4">
          <input type="hidden" name="billId" value={billId} />
          <input type="hidden" name="cadenceJson" value={JSON.stringify(cadenceObj)} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelStyle} htmlFor="cadence-type">
                Cadence type
              </label>
              <select
                id="cadence-type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className={inputStyle}
              >
                <option value="MONTHLY">Monthly</option>
                <option value="BIWEEKLY">Biweekly (every 2 weeks)</option>
                <option value="QUARTERLY">Quarterly (every 3 months)</option>
                <option value="ANNUAL">Annual (every 12 months)</option>
              </select>
            </div>

            {type === "MONTHLY" ? (
              <>
                <div>
                  <label className={labelStyle} htmlFor="cadence-day-of-month">
                    Day of month (1–31)
                  </label>
                  <input
                    id="cadence-day-of-month"
                    type="number"
                    min={1}
                    max={31}
                    value={dayOfMonth}
                    onChange={(e) => setDayOfMonth(Number(e.target.value))}
                    required
                    className={inputStyle}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelStyle} htmlFor="cadence-starts-from">
                    Starts from (optional)
                  </label>
                  <input
                    id="cadence-starts-from"
                    type="date"
                    value={startsFrom}
                    onChange={(e) => setStartsFrom(e.target.value)}
                    className={inputStyle}
                  />
                </div>
              </>
            ) : (
              <div>
                <label className={labelStyle} htmlFor="cadence-anchor">
                  Anchor date (known payment date)
                </label>
                <input
                  id="cadence-anchor"
                  type="date"
                  required
                  value={anchor}
                  onChange={(e) => setAnchor(e.target.value)}
                  className={inputStyle}
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setIsOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="xs">
              Save cadence
            </Button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p className="text-xs font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
