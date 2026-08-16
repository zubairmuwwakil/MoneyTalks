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
          <label className={label} htmlFor="bill-name">Name</label>
          <input id="bill-name" name="name" required placeholder="e.g. Hydro Electricity" className={input} />
        </div>
        <div>
          <label className={label} htmlFor="bill-category">Category</label>
          <select id="bill-category" name="category" className={input}>
            <option>housing</option>
            <option>utilities</option>
            <option>subscriptions</option>
            <option>transport</option>
            <option>debt</option>
            <option>other</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="bill-payee">Payee (optional)</label>
          <input id="bill-payee" name="payee" placeholder="e.g. Toronto Hydro" className={input} />
        </div>
        <div>
          <label className={label} htmlFor="bill-currency">Currency</label>
          <select id="bill-currency" name="currency" className={input}>
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
            <label className={label} htmlFor="bill-cadence">Cadence</label>
            <select id="bill-cadence" value={type} onChange={(e) => setType(e.target.value)} className={input}>
              <option>MONTHLY</option>
              <option>BIWEEKLY</option>
              <option>QUARTERLY</option>
              <option>ANNUAL</option>
            </select>
          </div>
          {type === "MONTHLY" ? (
            <>
              <div>
                <label className={label} htmlFor="bill-day-of-month">Day of month</label>
                <input
                  id="bill-day-of-month"
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(e.target.value)}
                  className={input}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={label} htmlFor="bill-starts-from">Starts from (optional)</label>
                <input
                  id="bill-starts-from"
                  type="date"
                  value={startsFrom}
                  onChange={(e) => setStartsFrom(e.target.value)}
                  className={input}
                />
              </div>
            </>
          ) : (
            <div>
              <label className={label} htmlFor="bill-anchor">
                Anchor date {type === "BIWEEKLY" ? "(known payment date)" : ""}
              </label>
              <input
                id="bill-anchor"
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
            <label className={label} htmlFor="bill-amount">Amount ($)</label>
            <input
              id="bill-amount"
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
            <label className={label} htmlFor="bill-amount-from">Amount effective from</label>
            <input
              id="bill-amount-from"
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
        <label className={label} htmlFor="bill-notes">Notes (optional)</label>
        <input id="bill-notes" name="notes" placeholder="Account numbers, portal links, notes" className={input} />
      </div>
    </>
  );
}
