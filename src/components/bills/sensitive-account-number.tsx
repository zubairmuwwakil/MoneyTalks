"use client";

import { Check, Copy, Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { revealStoredBillAccountNumber } from "@/app/bills/actions";

export function SensitiveAccountNumber({
  billId,
  masked,
  label = "Account number",
}: {
  billId: string;
  masked: string;
  label?: string | null;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!revealed) return;
    const timeout = window.setTimeout(() => setRevealed(null), 30_000);
    return () => window.clearTimeout(timeout);
  }, [revealed]);

  const reveal = () => {
    if (revealed) {
      setRevealed(null);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await revealStoredBillAccountNumber(billId);
      if (result.ok) setRevealed(result.accountNumber);
      else setError(result.error);
    });
  };

  const copy = async () => {
    let value = revealed;
    if (!value) {
      const result = await revealStoredBillAccountNumber(billId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      value = result.accountNumber;
    }
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground">{label || "Account number"}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <code className="min-w-32 rounded-md bg-muted px-2.5 py-1.5 text-xs font-semibold text-foreground">
          {revealed ?? masked}
        </code>
        <button
          type="button"
          onClick={reveal}
          disabled={pending}
          className="inline-flex size-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
          aria-label={revealed ? "Hide account number" : "Reveal account number"}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={copy}
          className="inline-flex size-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Copy account number"
        >
          {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
        </button>
        {revealed ? <span className="text-[10px] text-muted-foreground">Hides automatically in 30 seconds</span> : null}
      </div>
      {error ? <p className="text-[11px] text-red-600" role="alert">{error}</p> : null}
    </div>
  );
}
