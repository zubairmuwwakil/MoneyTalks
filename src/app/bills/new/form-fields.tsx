"use client";

import { useState } from "react";

const input = "mt-1 w-full rounded border px-3 py-2 text-sm";
const label = "block text-sm";

export function BillFormFields() {
  const [type, setType] = useState("MONTHLY");
  const [anchor, setAnchor] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [startsFrom, setStartsFrom] = useState("");
  const [from, setFrom] = useState("");
  const [amountMinor, setAmountMinor] = useState("");

  const cadence =
    type === "MONTHLY"
      ? { type, dayOfMonth: Number(dayOfMonth), ...(startsFrom ? { startsFrom } : {}) }
      : { type, anchor };
  const schedule = [{ from, amountMinor: Number(amountMinor) }];

  return (
    <>
      <input type="hidden" name="cadenceJson" value={JSON.stringify(cadence)} />
      <input type="hidden" name="scheduleJson" value={JSON.stringify(schedule)} />

      <div className="grid grid-cols-2 gap-4">
        <label className={label}>Name<input name="name" required className={input} /></label>
        <label className={label}>Category
          <select name="category" className={input}>
            <option>housing</option><option>utilities</option><option>subscriptions</option>
            <option>transport</option><option>debt</option><option>other</option>
          </select>
        </label>
        <label className={label}>Payee<input name="payee" className={input} /></label>
        <label className={label}>Currency
          <select name="currency" className={input}><option>CAD</option><option>USD</option><option>JMD</option></select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className={label}>Cadence
          <select value={type} onChange={(e) => setType(e.target.value)} className={input}>
            <option>MONTHLY</option><option>BIWEEKLY</option><option>QUARTERLY</option><option>ANNUAL</option>
          </select>
        </label>
        {type === "MONTHLY" ? (
          <>
            <label className={label}>Day of month
              <input type="number" min={1} max={31} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} className={input} />
            </label>
            <label className={label}>Starts from (optional)
              <input type="date" value={startsFrom} onChange={(e) => setStartsFrom(e.target.value)} className={input} />
            </label>
          </>
        ) : (
          <label className={label}>
            Anchor date {type === "BIWEEKLY" ? "(a known payment date — every 14 days from here)" : ""}
            <input type="date" required value={anchor} onChange={(e) => setAnchor(e.target.value)} className={input} />
          </label>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className={label}>Amount (cents)
          <input type="number" required value={amountMinor} onChange={(e) => setAmountMinor(e.target.value)} className={input} />
        </label>
        <label className={label}>Amount effective from
          <input type="date" required value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="autopay" value="true" /> Autopay
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="variable" value="true" /> Variable amount (track actuals)
      </label>
      <label className={label}>Notes<input name="notes" className={input} /></label>
    </>
  );
}
