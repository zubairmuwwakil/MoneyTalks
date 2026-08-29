import Link from "next/link";
import { ArrowLeft, CheckCircle2, FileSpreadsheet, Printer, ShieldCheck } from "lucide-react";
import { classifyWriteOff } from "@/engine/tax-writeoffs/classifyWriteOff";
import { summarizeWriteOffs, type WriteOffItem } from "@/engine/tax-writeoffs/writeOffSummary";
import { calculateItcRefund } from "@/engine/tax-writeoffs/itcTracker";
import type { Currency } from "@/engine/money";
import { formatMinorUnits } from "@/engine/money";
import { getOrCreateProfile } from "@/lib/profile";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { PrintButton } from "./PrintButton";

export default async function PrintTaxPackagePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const userId = await requireUserId();
  const { year } = await searchParams;
  const currentYear = year || new Date().getFullYear().toString();

  const [profile, purchases, bills] = await Promise.all([
    getOrCreateProfile(userId),
    prisma.purchase.findMany({
      where: { userId },
      include: {
        items: { select: { title: true } },
        attachments: { select: { id: true } },
      },
      orderBy: { purchasedAt: "desc" },
    }),
    prisma.bill.findMany({
      where: { userId },
      include: { payments: true },
    }),
  ]);

  const writeOffItems: WriteOffItem[] = [];

  // Evaluate purchases
  for (const p of purchases) {
    const classification = classifyWriteOff({
      merchant: p.merchant,
      category: p.category,
      items: p.items,
    });

    if (classification.isCandidate && classification.taxLine) {
      const grossAmountMinor = p.totalCents ?? 0;
      const businessPct = classification.suggestedBusinessPct;
      const claimedAmountMinor = Math.round(grossAmountMinor * (businessPct / 100));
      const hasReceiptProof = p.attachments.length > 0;
      const date = p.purchasedAt.toISOString().slice(0, 10);

      writeOffItems.push({
        id: `purchase_${p.id}`,
        date,
        source: "PURCHASE",
        merchant: p.merchant,
        grossAmountMinor,
        currency: (p.currency ?? "CAD") as Currency,
        form: classification.taxLine.form,
        line: classification.taxLine.line,
        lineName: classification.taxLine.name,
        businessPct,
        claimedAmountMinor,
        hasReceiptProof,
        notes: classification.rationale,
      });
    }
  }

  // Evaluate bills
  for (const b of bills) {
    const classification = classifyWriteOff({
      merchant: b.payee || b.name,
      name: b.name,
      category: b.category,
      spendCategory: b.spendCategory,
      notes: b.notes,
    });

    if (classification.isCandidate && classification.taxLine) {
      for (const payment of b.payments) {
        const grossAmountMinor = payment.actualAmountMinor ?? payment.expectedAmountMinor;
        const businessPct = classification.suggestedBusinessPct;
        const claimedAmountMinor = Math.round(grossAmountMinor * (businessPct / 100));
        const date = payment.dueDate.toISOString().slice(0, 10);

        writeOffItems.push({
          id: `bill_${payment.id}`,
          date,
          source: "BILL",
          merchant: b.payee || b.name,
          grossAmountMinor,
          currency: (b.currency ?? "CAD") as Currency,
          form: classification.taxLine.form,
          line: classification.taxLine.line,
          lineName: classification.taxLine.name,
          businessPct,
          claimedAmountMinor,
          hasReceiptProof: false,
          notes: `${b.name} (${classification.taxLine.name})`,
        });
      }
    }
  }

  // Filter to requested year
  const yearItems = writeOffItems.filter((i) => i.date.startsWith(currentYear));
  const summary = summarizeWriteOffs({
    items: yearItems,
    taxYear: currentYear,
    marginalRatePct: profile.marginalUSRatePct || 30,
  });

  const itcSummary = calculateItcRefund({
    items: yearItems,
    provinceCode: "ON",
    isRegistered: true,
  });

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="min-h-screen bg-background py-8 px-4 sm:px-8 max-w-4xl mx-auto space-y-8 print:p-0 print:m-0 print:max-w-full">
      {/* Screen-only Toolbar */}
      <div className="flex items-center justify-between border-b border-border/60 pb-4 print:hidden">
        <Link
          href="/money-finder/write-offs"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to Write-Offs Hub</span>
        </Link>
        <div className="flex items-center gap-2">
          <PrintButton />
        </div>
      </div>

      {/* Formal Tax Package Binder Document */}
      <div className="space-y-6 text-foreground">
        {/* Document Header */}
        <header className="border-b-2 border-foreground pb-4 space-y-1">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground block">
                In Unity Personal Finance Command Center
              </span>
              <h1 className="text-2xl font-bold tracking-tight">
                CRA Tax Return Deduction Package &amp; Audit Binder
              </h1>
            </div>
            <div className="text-right">
              <span className="text-xs font-mono font-bold block">Tax Year: {currentYear}</span>
              <span className="text-[11px] text-muted-foreground block">Generated: {todayIso}</span>
            </div>
          </div>
        </header>

        {/* Section 1: Executive Summary */}
        <section className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            1. Executive Deduction &amp; Refund Summary
          </h2>
          <div className="grid grid-cols-3 gap-3 border border-border/80 rounded-lg p-4 bg-muted/10 print:bg-transparent">
            <div>
              <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
                Total Deductions Claimed
              </span>
              <span className="text-xl font-mono font-bold text-foreground">
                {formatMinorUnits(summary.totalClaimedMinor, "CAD")}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
                Est. Income Tax Savings
              </span>
              <span className="text-xl font-mono font-bold text-primary">
                ~{formatMinorUnits(summary.estimatedTaxSavingsMinor, "CAD")}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
                GST/HST ITC Refund (Line 108)
              </span>
              <span className="text-xl font-mono font-bold text-foreground">
                {formatMinorUnits(itcSummary.totalItcRefundMinor, "CAD")}
              </span>
            </div>
          </div>
        </section>

        {/* Section 2: Form T2125 Business Expenses */}
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            2. CRA Form T2125: Statement of Business or Professional Activities
          </h2>
          <table className="w-full text-left text-xs border border-border/80 border-collapse">
            <thead>
              <tr className="bg-muted/40 border-b border-border/80 font-semibold text-[11px]">
                <th className="p-2.5">CRA Line</th>
                <th className="p-2.5">Description</th>
                <th className="p-2.5 text-right">Items</th>
                <th className="p-2.5 text-right">Gross Amount</th>
                <th className="p-2.5 text-right">Claimed Deductible</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {summary.byLine
                .filter((l) => l.form === "T2125")
                .map((line) => (
                  <tr key={line.line}>
                    <td className="p-2.5 font-mono font-semibold">Line {line.line}</td>
                    <td className="p-2.5">{line.lineName}</td>
                    <td className="p-2.5 text-right font-mono text-muted-foreground">{line.itemCount}</td>
                    <td className="p-2.5 text-right font-mono">{formatMinorUnits(line.totalGrossMinor, "CAD")}</td>
                    <td className="p-2.5 text-right font-mono font-bold text-primary">
                      {formatMinorUnits(line.totalClaimedMinor, "CAD")}
                    </td>
                  </tr>
                ))}
              <tr className="bg-muted/20 font-bold border-t-2 border-border/80">
                <td colSpan={3} className="p-2.5">
                  Total Form T2125 Business Deductions
                </td>
                <td className="p-2.5 text-right font-mono">
                  {formatMinorUnits(summary.byForm.T2125.totalGrossMinor, "CAD")}
                </td>
                <td className="p-2.5 text-right font-mono text-primary">
                  {formatMinorUnits(summary.byForm.T2125.totalClaimedMinor, "CAD")}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Section 3: Personal T1 Deductions & Non-Refundable Credits */}
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            3. Personal T1 Tax Return Deductions &amp; Credits
          </h2>
          <table className="w-full text-left text-xs border border-border/80 border-collapse">
            <thead>
              <tr className="bg-muted/40 border-b border-border/80 font-semibold text-[11px]">
                <th className="p-2.5">CRA Line</th>
                <th className="p-2.5">Schedule / Credit</th>
                <th className="p-2.5 text-right">Items</th>
                <th className="p-2.5 text-right">Total Claimed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {summary.byLine
                .filter((l) => l.form === "PERSONAL_T1")
                .map((line) => (
                  <tr key={line.line}>
                    <td className="p-2.5 font-mono font-semibold">Line {line.line}</td>
                    <td className="p-2.5">{line.lineName}</td>
                    <td className="p-2.5 text-right font-mono text-muted-foreground">{line.itemCount}</td>
                    <td className="p-2.5 text-right font-mono font-bold">
                      {formatMinorUnits(line.totalClaimedMinor, "CAD")}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>

        {/* Section 4: Itemized Audit Trail */}
        <section className="space-y-2 pt-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            4. Itemized Audit Trail &amp; Verification Evidence ({summary.totalItemCount} entries)
          </h2>
          <table className="w-full text-left text-[11px] border border-border/80 border-collapse">
            <thead>
              <tr className="bg-muted/40 border-b border-border/80 font-semibold text-[10px] uppercase">
                <th className="p-2">Date</th>
                <th className="p-2">Merchant / Payee</th>
                <th className="p-2">CRA Line</th>
                <th className="p-2 text-right">Gross</th>
                <th className="p-2 text-center">Business %</th>
                <th className="p-2 text-right">Claimed</th>
                <th className="p-2 text-center">Proof</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {summary.items.map((item) => (
                <tr key={item.id}>
                  <td className="p-2 font-mono whitespace-nowrap text-muted-foreground">{item.date}</td>
                  <td className="p-2 font-medium">{item.merchant}</td>
                  <td className="p-2 font-mono">
                    {item.form} Line {item.line}
                  </td>
                  <td className="p-2 text-right font-mono">{formatMinorUnits(item.grossAmountMinor, item.currency)}</td>
                  <td className="p-2 text-center font-mono">{item.businessPct}%</td>
                  <td className="p-2 text-right font-mono font-semibold">
                    {formatMinorUnits(item.claimedAmountMinor, item.currency)}
                  </td>
                  <td className="p-2 text-center">
                    {item.hasReceiptProof ? "VERIFIED" : "STATEMENT"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Statutory CRA Notice Footer */}
        <footer className="border-t border-border/80 pt-4 text-[10px] text-muted-foreground leading-relaxed">
          <p>
            <strong>CRA Record-Keeping Compliance:</strong> Under subsection 230(4) of the Canadian Income Tax Act, you
            must retain all receipts, invoices, cancelled cheques, and logbooks supporting these claimed deductions for
            a minimum of <strong>six (6) years</strong> from the end of the tax year to which they relate.
          </p>
        </footer>
      </div>
    </div>
  );
}
