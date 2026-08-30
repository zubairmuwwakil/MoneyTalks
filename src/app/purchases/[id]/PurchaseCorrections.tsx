"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { correctPurchaseDetails, markPurchaseDeclined, markPurchaseReversed, permanentlyDeletePurchase, undoLatestPurchaseCorrection } from "./actions";

export default function PurchaseCorrections(props: {
  purchaseId: string; merchant: string; totalCents: number | null; currency: string | null;
  paymentMethod: string | null; financialState: string; canUndo: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [merchant, setMerchant] = useState(props.merchant);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const isTerminal = props.financialState === "DECLINED" || props.financialState === "REVERSED";

  function run(action: () => Promise<{ ok: boolean; error?: string } | void>) {
    start(async () => {
      try { const result = await action(); if (result && !result.ok) setMessage(result.error ?? "Could not update purchase"); else { setMessage(null); router.refresh(); } }
      catch { setMessage("Could not update purchase"); }
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={pending || isTerminal}
          onClick={() => { if (confirm("Mark this payment as not completed? Rewards and cap effects will be reversed.")) run(() => markPurchaseDeclined(props.purchaseId)); }}>
          Payment didn&apos;t complete
        </Button>
        <Button variant="outline" size="sm" disabled={pending || isTerminal}
          onClick={() => { if (confirm("Mark this purchase as refunded or reversed?")) run(() => markPurchaseReversed(props.purchaseId)); }}>
          Refunded / reversed
        </Button>
        <Button variant="outline" size="sm" disabled={pending || isTerminal} onClick={() => setEditing((v) => !v)}>Edit details</Button>
        {props.canUndo ? <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => undoLatestPurchaseCorrection(props.purchaseId))}>Undo latest change</Button> : null}
      </div>
      {editing ? (
        <form action={(form) => run(() => correctPurchaseDetails(form))} className="grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="purchaseId" value={props.purchaseId} />
          <label className="text-xs">Merchant<input name="merchant" value={merchant} onChange={(event) => setMerchant(event.target.value)} className="mt-1 w-full rounded-md border bg-background px-3 py-2" required /></label>
          <label className="text-xs">Amount<input name="amount" type="number" min="0" step="0.01" defaultValue={props.totalCents == null ? "" : (props.totalCents / 100).toFixed(2)} className="mt-1 w-full rounded-md border bg-background px-3 py-2" /></label>
          <label className="text-xs">Currency<input name="currency" defaultValue={props.currency ?? "CAD"} maxLength={3} className="mt-1 w-full rounded-md border bg-background px-3 py-2 uppercase" /></label>
          <label className="text-xs">Card ID<input name="paymentMethod" defaultValue={props.paymentMethod ?? ""} className="mt-1 w-full rounded-md border bg-background px-3 py-2" /></label>
          <label className="flex items-center gap-2 text-xs sm:col-span-2">
            <input name="rememberMerchantCurrency" type="checkbox" className="size-4" />
            Remember this currency for <span className="font-medium">{merchant.trim() || props.merchant}</span>
          </label>
          <Button type="submit" size="sm" disabled={pending}>Save corrected details</Button>
        </form>
      ) : null}
      <div className="border-t border-border/60 pt-3">
        <Button variant="destructive" size="sm" disabled={pending}
          onClick={() => { if (confirm("Permanently delete this purchase and its underlying Wallet capture? This cannot be undone.")) run(async () => { await permanentlyDeletePurchase(props.purchaseId); router.push("/purchases"); }); }}>
          Delete permanently
        </Button>
      </div>
      {message ? <p className="text-xs text-destructive">{message}</p> : null}
    </div>
  );
}
