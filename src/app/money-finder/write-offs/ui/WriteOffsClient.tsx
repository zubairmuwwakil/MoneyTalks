"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle2,
  Coins,
  Download,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Filter,
  HelpCircle,
  Home,
  Laptop,
  Percent,
  Printer,
  Receipt,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  generateWriteOffsCsv,
  summarizeWriteOffs,
  type WriteOffItem,
  type WriteOffSummaryResult,
} from "@/engine/tax-writeoffs/writeOffSummary";
import {
  calculateItcRefund,
  PROVINCE_ITC_RATES,
  type ItcCalculationResult,
} from "@/engine/tax-writeoffs/itcTracker";
import { HomeOfficeWizard } from "./HomeOfficeWizard";
import { MileageWizard } from "./MileageWizard";
import type { CraFormType } from "@/engine/tax-writeoffs/craTaxLines";
import { formatMinorUnits } from "@/engine/money";

interface WriteOffsClientProps {
  initialItems: WriteOffItem[];
  initialTaxYear: string;
  userMarginalRatePct: number;
}

export function WriteOffsClient({
  initialItems,
  initialTaxYear,
  userMarginalRatePct,
}: WriteOffsClientProps) {
  const [items, setItems] = useState<WriteOffItem[]>(initialItems);
  const [selectedYear, setSelectedYear] = useState<string>(initialTaxYear);
  const [activeTab, setActiveTab] = useState<"ALL" | CraFormType>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [onlyWithReceipts, setOnlyWithReceipts] = useState(false);
  const [customMarginalRate, setCustomMarginalRate] = useState<number>(userMarginalRatePct || 30);
  const [isGstRegistered, setIsGstRegistered] = useState<boolean>(true);
  const [itcProvince, setItcProvince] = useState<string>("ON");

  // Available tax years from data
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    years.add(initialTaxYear);
    items.forEach((i) => {
      if (i.date) {
        years.add(i.date.slice(0, 4));
      }
    });
    return Array.from(years).sort().reverse();
  }, [items, initialTaxYear]);

  // Filtered by year
  const yearFilteredItems = useMemo(() => {
    return items.filter((i) => !selectedYear || i.date.startsWith(selectedYear));
  }, [items, selectedYear]);

  // Summary computed over the chosen year
  const summary: WriteOffSummaryResult = useMemo(() => {
    return summarizeWriteOffs({
      items: yearFilteredItems,
      taxYear: selectedYear,
      marginalRatePct: customMarginalRate,
    });
  }, [yearFilteredItems, selectedYear, customMarginalRate]);

  // GST/HST ITC Claim calculation
  const itcResult: ItcCalculationResult = useMemo(() => {
    return calculateItcRefund({
      items: yearFilteredItems,
      provinceCode: itcProvince,
      isRegistered: isGstRegistered,
    });
  }, [yearFilteredItems, itcProvince, isGstRegistered]);

  // UI filtered items (tab + search + receipts filter)
  const displayedItems = useMemo(() => {
    return yearFilteredItems.filter((i) => {
      if (activeTab !== "ALL" && i.form !== activeTab) return false;
      if (onlyWithReceipts && !i.hasReceiptProof) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const text = `${i.merchant} ${i.lineName} ${i.line} ${i.notes ?? ""}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [yearFilteredItems, activeTab, onlyWithReceipts, searchQuery]);

  // Handler to update business % allocation
  const handleUpdateAllocation = (itemId: string, newPct: number) => {
    const clamped = Math.max(0, Math.min(100, newPct));
    setItems((prev) =>
      prev.map((item) => {
        if (item.id === itemId) {
          const claimedAmountMinor = Math.round(item.grossAmountMinor * (clamped / 100));
          return { ...item, businessPct: clamped, claimedAmountMinor };
        }
        return item;
      }),
    );
  };

  // Handler for Home Office workspace ratio application
  const handleApplyHomeOfficeRatio = (ratioPct: number, rationale: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.line === "9281" || item.line === "T777-Utilities") {
          const claimedAmountMinor = Math.round(item.grossAmountMinor * (ratioPct / 100));
          return {
            ...item,
            businessPct: ratioPct,
            claimedAmountMinor,
            notes: item.notes ? `${item.notes} · ${rationale}` : rationale,
          };
        }
        return item;
      }),
    );
  };

  // Handler for Mileage Allowance addition
  const handleAddMileageAllowance = ({
    totalKm,
    amountMinor,
    notes,
  }: {
    totalKm: number;
    amountMinor: number;
    notes: string;
  }) => {
    const mileageItem: WriteOffItem = {
      id: `mileage_allowance_${selectedYear}_${Date.now()}`,
      date: `${selectedYear}-12-31`,
      source: "TRANSACTION",
      merchant: "Motor Vehicle Travel Allowance (CRA Rate)",
      grossAmountMinor: amountMinor,
      currency: "CAD",
      form: "T2125",
      line: "9281",
      lineName: "Motor Vehicle Travel Allowance (Prescribed Rate)",
      businessPct: 100,
      claimedAmountMinor: amountMinor,
      hasReceiptProof: true,
      notes,
    };
    setItems((prev) => [mileageItem, ...prev]);
  };

  // Download CSV export
  const handleDownloadCsv = () => {
    const csvContent = generateWriteOffsCsv(summary);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `InUnity_CRA_Tax_Deductions_${selectedYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Year Selector */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/money-finder"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-2 transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            <span>Back to Money Finder</span>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            CRA Tax Write-Off &amp; Deduction Tracker
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Audit-safe business &amp; personal deductions mapped directly to official CRA lines.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Year Picker */}
          <div className="flex items-center rounded-lg border border-input bg-card px-2.5 py-1 text-xs shadow-2xs">
            <Calendar className="size-3.5 mr-1.5 text-muted-foreground" />
            <span className="text-muted-foreground mr-1 font-medium">Tax Year:</span>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="bg-transparent font-semibold text-foreground focus:outline-none cursor-pointer"
            >
              {availableYears.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          </div>

          <Button
            asChild
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs font-semibold shadow-2xs cursor-pointer"
          >
            <Link href={`/money-finder/write-offs/print?year=${selectedYear}`}>
              <Printer className="size-3.5 text-primary" />
              <span>Print Tax Binder</span>
            </Link>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDownloadCsv}
            className="gap-1.5 text-xs font-semibold shadow-2xs cursor-pointer"
          >
            <Download className="size-3.5 text-primary" />
            <span>Export CSV</span>
          </Button>
        </div>
      </div>

      {/* Summary Scorecard HUD */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Claimed Deductions */}
        <Card className="border-border/80 shadow-2xs bg-card">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-semibold tracking-wider text-muted-foreground flex items-center justify-between">
              <span>Total Deductions</span>
              <FileText className="size-4 text-primary" />
            </CardDescription>
            <CardTitle className="text-2xl font-mono font-bold text-foreground">
              {formatMinorUnits(summary.totalClaimedMinor, "CAD")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">
              From {formatMinorUnits(summary.totalGrossMinor, "CAD")} gross across {summary.totalItemCount} items.
            </p>
          </CardContent>
        </Card>

        {/* Estimated Income Tax Savings */}
        <Card className="border-border/80 shadow-2xs bg-primary/5 border-primary/20">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-semibold tracking-wider text-primary flex items-center justify-between">
              <span>Income Tax Savings</span>
              <Sparkles className="size-4 text-primary" />
            </CardDescription>
            <CardTitle className="text-2xl font-mono font-bold text-primary">
              ~{formatMinorUnits(summary.estimatedTaxSavingsMinor, "CAD")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Marginal rate:</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="10"
                  max="60"
                  value={customMarginalRate}
                  onChange={(e) => setCustomMarginalRate(Number(e.target.value) || 30)}
                  className="w-12 rounded border border-input bg-background px-1.5 py-0.5 text-right font-mono text-xs"
                />
                <span className="font-semibold">%</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* GST/HST ITC Refund (Line 108) */}
        <Card className="border-border/80 shadow-2xs bg-card">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-semibold tracking-wider text-muted-foreground flex items-center justify-between">
              <span>GST/HST ITC Refund</span>
              <Coins className="size-4 text-amber-500" />
            </CardDescription>
            <CardTitle className="text-2xl font-mono font-bold text-foreground">
              {isGstRegistered ? formatMinorUnits(itcResult.totalItcRefundMinor, "CAD") : "$0.00"}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>CRA GST34 Line 108:</span>
              <select
                value={itcProvince}
                onChange={(e) => setItcProvince(e.target.value)}
                className="bg-transparent font-semibold text-foreground focus:outline-none cursor-pointer"
              >
                {Object.values(PROVINCE_ITC_RATES).map((p) => (
                  <option key={p.provinceCode} value={p.provinceCode}>
                    {p.provinceCode} ({p.rateLabel})
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Receipt Proof Coverage */}
        <Card className="border-border/80 shadow-2xs bg-card">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-semibold tracking-wider text-muted-foreground flex items-center justify-between">
              <span>Receipt Proof</span>
              <ShieldCheck className="size-4 text-emerald-500" />
            </CardDescription>
            <CardTitle className="text-2xl font-mono font-bold text-foreground">
              {summary.receiptCoveragePct}%
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">
              {summary.receiptProofCount} of {summary.totalItemCount} items backed by attached receipts.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Home Office & Vehicle Mileage Wizards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <HomeOfficeWizard
          currentWorkspacePct={15}
          onApplyRatio={handleApplyHomeOfficeRatio}
        />
        <MileageWizard
          onAddMileageAllowance={handleAddMileageAllowance}
        />
      </div>

      {/* Schedule Tabs & Filters */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-3">
          {/* Tab buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab("ALL")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === "ALL"
                  ? "bg-foreground text-background shadow-2xs"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              All Categories ({summary.totalItemCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("T2125")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === "T2125"
                  ? "bg-foreground text-background shadow-2xs"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Laptop className="size-3.5" />
              <span>T2125 Business ({summary.byForm.T2125.itemCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("T777")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === "T777"
                  ? "bg-foreground text-background shadow-2xs"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Building2 className="size-3.5" />
              <span>T777 Remote Work ({summary.byForm.T777.itemCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("PERSONAL_T1")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === "PERSONAL_T1"
                  ? "bg-foreground text-background shadow-2xs"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <HeartPulseIcon className="size-3.5" />
              <span>Personal T1 ({summary.byForm.PERSONAL_T1.itemCount})</span>
            </button>
          </div>

          {/* Search and proof toggle */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search write-offs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 w-44 sm:w-56 rounded-md border border-input bg-background pl-8 pr-2.5 text-xs shadow-2xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyWithReceipts}
                onChange={(e) => setOnlyWithReceipts(e.target.checked)}
                className="rounded accent-primary"
              />
              <span>With Receipt</span>
            </label>
          </div>
        </div>

        {/* Line Items Table */}
        <div className="rounded-xl border border-border/80 bg-card shadow-2xs overflow-hidden">
          {displayedItems.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <FileCheck className="size-8 mx-auto text-muted-foreground/50" />
              <p className="text-sm font-semibold text-foreground">No matching tax deductions found</p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                No items match your filter criteria for {selectedYear}. Transactions and recurring bills matching
                SaaS, utilities, health, and donations will appear automatically.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30 text-muted-foreground uppercase tracking-wider font-semibold text-[10px]">
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Merchant / Service</th>
                    <th className="py-3 px-4">CRA Line &amp; Schedule</th>
                    <th className="py-3 px-4 text-right">Gross</th>
                    <th className="py-3 px-4 text-center">Business %</th>
                    <th className="py-3 px-4 text-right">Claimed</th>
                    <th className="py-3 px-4 text-center">Proof</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {displayedItems.map((item) => (
                    <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-3 px-4 font-mono whitespace-nowrap text-muted-foreground">
                        {item.date}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-semibold text-foreground block">{item.merchant}</span>
                        {item.notes ? (
                          <span className="text-[11px] text-muted-foreground block truncate max-w-xs">
                            {item.notes}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {item.form} Line {item.line}
                          </Badge>
                        </div>
                        <span className="text-[11px] text-muted-foreground mt-0.5 block">
                          {item.lineName}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-medium text-muted-foreground whitespace-nowrap">
                        {formatMinorUnits(item.grossAmountMinor, item.currency)}
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleUpdateAllocation(item.id, 50)}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                              item.businessPct === 50
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted/60 text-muted-foreground hover:bg-muted"
                            }`}
                            title="Set 50% business allocation"
                          >
                            50%
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateAllocation(item.id, 100)}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                              item.businessPct === 100
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted/60 text-muted-foreground hover:bg-muted"
                            }`}
                            title="Set 100% business allocation"
                          >
                            100%
                          </button>
                          <div className="relative inline-flex items-center">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={item.businessPct}
                              onChange={(e) =>
                                handleUpdateAllocation(item.id, parseInt(e.target.value, 10) || 0)
                              }
                              className="w-12 h-6 rounded border border-input bg-background text-center font-mono text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            />
                            <span className="ml-0.5 text-[10px] text-muted-foreground">%</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-primary whitespace-nowrap">
                        {formatMinorUnits(item.claimedAmountMinor, item.currency)}
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        {item.hasReceiptProof ? (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full"
                            title="Receipt or document on file"
                          >
                            <Receipt className="size-3" />
                            Verified
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-full"
                            title="No receipt document attached"
                          >
                            Statement
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* CRA Line Breakdown Section */}
      {summary.byLine.length > 0 ? (
        <div className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs space-y-3">
          <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
            <FileSpreadsheet className="size-4 text-primary" />
            <span>CRA Schedule Summary for Your Return ({selectedYear})</span>
          </h2>
          <p className="text-xs text-muted-foreground">
            Copy these totals directly into your tax filing software (Wealthsimple Tax, TurboTax, or give to your CPA).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2">
            {summary.byLine.map((line) => (
              <div
                key={`${line.form}_${line.line}`}
                className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-1"
              >
                <div className="flex items-center justify-between text-xs">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {line.form} · Line {line.line}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">{line.itemCount} items</span>
                </div>
                <p className="text-xs font-semibold text-foreground truncate">{line.lineName}</p>
                <p className="font-mono text-sm font-bold text-primary">
                  {formatMinorUnits(line.totalClaimedMinor, "CAD")}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* CRA Disclaimer Footer */}
      <footer className="rounded-xl border border-border/80 bg-muted/20 p-4 text-xs text-muted-foreground leading-relaxed">
        <strong>Important Tax Notice:</strong> In Unity categorizes potential tax deductions according to published
        CRA guidelines. This does not constitute formal legal or tax advice. For Form T777 employment expenses, a
        signed Form T2200 from your employer is required. Ensure you retain receipts for all claimed business and
        medical expenses for at least 6 years per CRA audit requirements.
      </footer>
    </div>
  );
}

function HeartPulseIcon(props: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
    >
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      <path d="M12 5 9.04 7.96a2.17 2.17 0 0 0-.54 2.21L10 14" />
    </svg>
  );
}
