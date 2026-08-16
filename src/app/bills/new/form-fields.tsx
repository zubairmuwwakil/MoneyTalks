"use client";

import { useState } from "react";

const input =
  "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring";
const label = "block text-xs font-medium text-foreground mb-1";

export function BillFormFields() {
  const [type, setType] = useState("MONTHLY");
  const [anchor, setAnchor] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [startsFrom, setStartsFrom] = useState("");
  const [from, setFrom] = useState("");
  const [amount, setAmount] = useState("");

  const cadence =
    type === "MONTHLY"
      ? { type, dayOfMonth: Number(dayOfMonth), ...(startsFrom ? { startsFrom } : {}) }
      : { type, anchor };
  const schedule = [{ from, amount }];

  return (
    <>
      <input type="hidden" name="cadenceJson" value={JSON.stringify(cadence)} />
      <input type="hidden" name="scheduleJson" value={JSON.stringify(schedule)} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={label}>Name</label>
          <input name="name" required placeholder="e.g. Hydro Electricity" className={input} />
        </div>
        <div>
          <label className={label}>Category</label>
          <select name="category" className={input}>
            <option>housing</option>
            <option>utilities</option>
            <option>subscriptions</option>
            <option>transport</option>
            <option>debt</option>
            <option>other</option>
          </select>
        </div>
        <div>
          <label className={label}>Payee (optional)</label>
          <input name="payee" placeholder="e.g. Toronto Hydro" className={input} />
        </div>
        <div>
          <label className={label}>Currency</label>
          <select name="currency" className={input}>
            <option>CAD</option>
            <option>USD</option>
            <option>JMD</option>
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-border/80 bg-muted/20 p-4 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Schedule &amp; Cadence
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={label}>Cadence</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className={input}>
              <option>MONTHLY</option>
              <option>BIWEEKLY</option>
              <option>QUARTERLY</option>
              <option>ANNUAL</option>
            </select>
          </div>
          {type === "MONTHLY" ? (
            <>
              <div>
                <label className={label}>Day of month</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(e.target.value)}
                  className={input}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={label}>Starts from (optional)</label>
                <input
                  type="date"
                  value={startsFrom}
                  onChange={(e) => setStartsFrom(e.target.value)}
                  className={input}
                />
              </div>
            </>
          ) : (
            <div>
              <label className={label}>
                Anchor date {type === "BIWEEKLY" ? "(known payment date)" : ""}
              </label>
              <input
                type="date"
                required
                value={anchor}
                onChange={(e) => setAnchor(e.target.value)}
                className={input}
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 border-t border-border/60 pt-4">
          <div>
            <label className={label}>Amount ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              required
              value={amount}
              placeholder="e.g. 120.00"
              onChange={(e) => setAmount(e.target.value)}
              className={input}
            />
          </div>
          <div>
            <label className={label}>Amount effective from</label>
            <input
              type="date"
              required
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={input}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-border/80 bg-muted/20 p-4">
        <label className="flex items-center gap-2.5 text-xs font-medium text-foreground cursor-pointer">
          <input type="checkbox" name="autopay" value="true" className="rounded" />
          <span>Autopay enabled (automatically debited)</span>
        </label>
        <label className="flex items-center gap-2.5 text-xs font-medium text-foreground cursor-pointer">
          <input type="checkbox" name="variable" value="true" className="rounded" />
          <span>Variable amount (track actual invoiced amounts vs estimate)</span>
        </label>
      </div>

      <div>
        <label className={label}>Notes (optional)</label>
        <input name="notes" placeholder="Account numbers, portal links, notes" className={input} />
      </div>
    </>
  );
}
