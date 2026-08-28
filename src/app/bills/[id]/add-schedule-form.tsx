"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { TaxCalculator } from "@/components/bills/tax-calculator";
import { Button } from "@/components/ui/button";

const inputStyle =
  "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring";

export function AddScheduleForm({
  billId,
  currency = "CAD",
  action,
  error,
}: {
  billId: string;
  currency?: string;
  action: (formData: FormData) => Promise<void>;
  error?: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const handleApplyTax = (newAmountStr: string, calcNote?: string) => {
    setAmount(newAmountStr);
    if (calcNote && !note) {
      setNote(calcNote);
    }
  };

  return (
    <div className="space-y-3">
      <form action={action} className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
        <input type="hidden" name="billId" value={billId} />
        <div>
          <label className="block text-[10px] uppercase font-semibold text-muted-foreground mb-1">
            From Date *
          </label>
          <input
            name="from"
            type="date"
            required
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={inputStyle}
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase font-semibold text-muted-foreground mb-1">
            To Date (Optional)
          </label>
          <input
            name="to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="Open-ended"
            className={inputStyle}
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase font-semibold text-muted-foreground mb-1">
            Amount ($) *
          </label>
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 120.00"
            className={inputStyle}
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase font-semibold text-muted-foreground mb-1">
            Note (Optional)
          </label>
          <input
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Promo rate"
            className={inputStyle}
          />
        </div>
        <div className="col-span-2 sm:col-span-1 flex items-end">
          <Button
            type="submit"
            size="sm"
            className="w-full h-9 gap-1.5 font-semibold text-xs cursor-pointer"
          >
            <Plus className="size-3.5" />
            <span>Add Step</span>
          </Button>
        </div>
      </form>

      <div className="pt-1">
        <TaxCalculator
          currentAmount={amount}
          currency={currency}
          onApplyAmount={handleApplyTax}
        />
      </div>

      {error ? (
        <p className="text-xs font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
