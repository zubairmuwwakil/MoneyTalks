"use client";

import type { CardFormValues } from "@/components/card-form";
import { CATEGORY_LABELS } from "@/lib/cards/types";
import { CATEGORY_ICONS } from "@/lib/cards/presets";
import { Globe, Sparkles, Zap, ShieldCheck } from "lucide-react";

interface CardPreviewProps {
  values: CardFormValues;
}

function resolveCardTheme(issuer: string, nickname: string): string {
  const text = `${issuer} ${nickname}`.toLowerCase();
  if (text.includes("cobalt")) return "from-blue-950 via-slate-900 to-sky-950 text-blue-100 border-blue-500/40";
  if (text.includes("platinum")) return "from-zinc-300 via-stone-200 to-zinc-400 text-zinc-900 border-zinc-100 shadow-zinc-900/20";
  if (text.includes("bonvoy") || text.includes("marriott")) return "from-amber-950 via-rose-950 to-stone-950 text-amber-100 border-amber-500/30";
  if (text.includes("westjet")) return "from-teal-900 via-cyan-950 to-slate-950 text-teal-100 border-teal-500/30";
  if (text.includes("amazon")) return "from-stone-900 via-zinc-900 to-amber-950 text-amber-200 border-amber-500/30";
  if (text.includes("pc ") || text.includes("optimum") || text.includes("insiders")) return "from-red-950 via-rose-900 to-neutral-950 text-red-50 border-rose-500/30";
  if (text.includes("national bank")) return "from-red-900 via-rose-950 to-neutral-950 text-red-100 border-red-600/30";
  if (text.includes("mbna")) return "from-slate-900 via-sky-950 to-zinc-950 text-sky-100 border-sky-600/30";
  if (text.includes("gold amex") || text.includes("gold american")) return "from-amber-600 via-yellow-700 to-stone-900 text-amber-50 border-amber-400/40";
  if (text.includes("scotia") || text.includes("scotiabank")) return "from-red-800 via-rose-950 to-zinc-950 text-rose-50 border-rose-600/30";
  if (text.includes("td")) return "from-emerald-800 via-emerald-950 to-zinc-950 text-emerald-50 border-emerald-600/30";
  if (text.includes("rbc") || text.includes("avion") || text.includes("ion")) return "from-blue-700 via-blue-950 to-slate-950 text-blue-50 border-blue-500/30";
  if (text.includes("cibc")) return "from-rose-950 via-red-950 to-stone-950 text-rose-100 border-rose-700/30";
  if (text.includes("bmo") || text.includes("eclipse") || text.includes("ascend")) return "from-sky-800 via-blue-950 to-slate-950 text-sky-50 border-sky-600/30";
  if (text.includes("rogers")) return "from-red-700 via-rose-950 to-zinc-950 text-red-50 border-red-500/30";
  if (text.includes("tangerine")) return "from-orange-600 via-amber-800 to-stone-950 text-orange-50 border-orange-400/30";
  if (text.includes("wealthsimple")) return "from-neutral-900 via-zinc-950 to-black text-amber-200 border-amber-500/30";
  if (text.includes("triangle") || text.includes("canadian tire")) return "from-red-700 via-red-950 to-neutral-950 text-red-50 border-red-500/30";
  if (text.includes("crypto") || text.includes("indigo")) return "from-indigo-900 via-slate-950 to-zinc-950 text-indigo-100 border-indigo-500/30";
  if (text.includes("amex") || text.includes("american express")) return "from-slate-800 via-blue-950 to-slate-900 text-blue-50 border-blue-500/30";
  return "from-slate-800 via-slate-900 to-zinc-950 text-slate-100 border-slate-700/50";
}

export function CardPreview({ values }: CardPreviewProps) {
  const themeClass = resolveCardTheme(values.issuer, values.nickname);
  const isPlatinum = `${values.issuer} ${values.nickname}`.toLowerCase().includes("platinum");
  const feeNum = parseFloat(values.annualFee) || 0;
  const pointVal = parseFloat(values.rewards.pointValueCents) || 1;
  const baseRate = parseFloat(values.rewards.baseMultiplier) || 1;
  const fxPct = parseFloat(values.rewards.fxFeePct) || 0;

  // Calculate annual credit offsets
  const totalAnnualCredits = values.rewards.credits.reduce((sum, c) => {
    const val = parseFloat(c.value) || 0;
    return sum + (c.period === "MONTH" ? val * 12 : val);
  }, 0);

  // Top category multipliers (sorted highest first)
  const topCategories = [...values.rewards.categoryRates]
    .filter((r) => parseFloat(r.multiplier) > 0)
    .sort((a, b) => (parseFloat(b.multiplier) || 0) - (parseFloat(a.multiplier) || 0))
    .slice(0, 4);

  const highestMultiplier = Math.max(
    baseRate,
    ...values.rewards.categoryRates.map((r) => parseFloat(r.multiplier) || 0),
    ...values.rewards.baseRateOverrides.map((r) => parseFloat(r.multiplier) || 0),
    ...values.rewards.merchantRates.map((r) => parseFloat(r.multiplier) || 0)
  );

  const maxEffectiveReturnPct = (highestMultiplier * pointVal).toFixed(1);
  const baseReturnPct = (baseRate * pointVal).toFixed(1);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Live Card Preview
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
          <Sparkles className="size-3" />
          <span>Interactive</span>
        </span>
      </div>

      {/* Realistic Credit Card Artwork */}
      <div
        className={`relative aspect-[1.586/1] w-full max-w-sm rounded-2xl bg-gradient-to-tr p-5 shadow-xl border overflow-hidden flex flex-col justify-between select-none transition-all duration-300 ${themeClass}`}
      >
        {/* Subtle sheen background effect */}
        <div className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 h-48 w-48 rounded-full bg-black/20 blur-2xl pointer-events-none" />

        {/* Top Row: Issuer & Network */}
        <div className="relative z-10 flex items-start justify-between gap-2">
          <div>
            <p className={`text-[11px] font-semibold tracking-wider uppercase ${isPlatinum ? "text-zinc-600" : "text-white/75"}`}>
              {values.issuer.trim() || "Issuer Name"}
            </p>
            <h3 className={`text-base sm:text-lg font-bold tracking-tight line-clamp-1 ${isPlatinum ? "text-zinc-900" : "text-white"}`}>
              {values.nickname.trim() || "Card Nickname"}
            </h3>
          </div>
          <div className="flex flex-col items-end">
            <span
              className={`rounded-md px-2 py-0.5 text-[10px] font-extrabold tracking-widest uppercase border ${
                isPlatinum
                  ? "bg-zinc-900 text-white border-zinc-700"
                  : "bg-white/15 text-white border-white/20 backdrop-blur-xs"
              }`}
            >
              {values.network}
            </span>
          </div>
        </div>

        {/* Middle: EMV Chip & Contactless */}
        <div className="relative z-10 flex items-center gap-3 my-auto">
          {/* Chip graphic */}
          <div className="h-7 w-9 rounded-md bg-gradient-to-br from-amber-200 via-yellow-400 to-amber-500 border border-amber-600/50 shadow-inner flex items-center justify-center p-1">
            <div className="h-full w-full border border-amber-800/30 rounded-xs grid grid-cols-2 gap-0.5 opacity-60">
              <div className="border-r border-amber-800/40" />
              <div />
            </div>
          </div>
          {/* Contactless symbol */}
          <svg className={`size-4 rotate-90 ${isPlatinum ? "text-zinc-500" : "text-white/60"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M8.5 16.5a5 5 0 0 1 0-9" />
            <path d="M12 19a8.5 8.5 0 0 1 0-14" />
            <path d="M15.5 21.5a12 12 0 0 1 0-19" />
          </svg>
        </div>

        {/* Bottom Row: Card Digits & Annual Fee Badge */}
        <div className="relative z-10 flex items-end justify-between gap-2 pt-2">
          <div>
            <p className={`font-mono text-xs tracking-widest ${isPlatinum ? "text-zinc-700" : "text-white/80"}`}>
              •••• •••• •••• {values.lastFour.trim() ? values.lastFour : "••••"}
            </p>
            <p className={`text-[10px] ${isPlatinum ? "text-zinc-500" : "text-white/60"} mt-0.5`}>
              {values.currency} • {values.country}
            </p>
          </div>
          <div className="text-right">
            <span
              className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                feeNum === 0
                  ? isPlatinum
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30"
                  : isPlatinum
                  ? "bg-zinc-200 text-zinc-800"
                  : "bg-white/20 text-white border border-white/20"
              }`}
            >
              {feeNum === 0 ? "No annual fee" : `$${feeNum.toFixed(2)}/yr`}
            </span>
          </div>
        </div>
      </div>

      {/* Snapshot Summary Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {/* Peak Return */}
        <div className="rounded-lg border border-border/70 bg-card p-2.5 shadow-2xs">
          <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <Zap className="size-3 text-amber-500" />
            <span>Max earn rate</span>
          </div>
          <p className="mt-1 text-sm font-bold text-foreground">
            {highestMultiplier}x <span className="text-xs font-normal text-muted-foreground">({maxEffectiveReturnPct}%)</span>
          </p>
          <span className="text-[10px] text-muted-foreground">Base: {baseRate}x ({baseReturnPct}%)</span>
        </div>

        {/* FX Fee */}
        <div className="rounded-lg border border-border/70 bg-card p-2.5 shadow-2xs">
          <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <Globe className="size-3 text-sky-500" />
            <span>Foreign FX Fee</span>
          </div>
          <p className={`mt-1 text-sm font-bold ${fxPct === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
            {fxPct === 0 ? "0% (No FX fee)" : `${fxPct}%`}
          </p>
          <span className="text-[10px] text-muted-foreground">
            {fxPct === 0 ? "Ideal for foreign spend" : "Standard FX markup"}
          </span>
        </div>

        {/* Net Fee After Credits */}
        <div className="col-span-2 sm:col-span-1 rounded-lg border border-border/70 bg-card p-2.5 shadow-2xs">
          <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <ShieldCheck className="size-3 text-emerald-500" />
            <span>Net Annual Fee</span>
          </div>
          <p className="mt-1 text-sm font-bold text-foreground">
            ${Math.max(0, feeNum - totalAnnualCredits).toFixed(2)}/yr
          </p>
          <span className="text-[10px] text-muted-foreground">
            {totalAnnualCredits > 0 ? `-$${totalAnnualCredits.toFixed(0)} credits` : "No credits applied"}
          </span>
        </div>
      </div>

      {/* Top Bonus Categories Chips */}
      {topCategories.length > 0 && (
        <div className="rounded-lg border border-border/70 bg-muted/20 p-2.5 space-y-1.5">
          <span className="text-[11px] font-semibold text-foreground">Top Category Multipliers</span>
          <div className="flex flex-wrap gap-1.5">
            {topCategories.map((rate) => (
              <span
                key={rate.category}
                className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-1 text-xs font-medium text-foreground border border-border/80 shadow-2xs"
              >
                <span>{CATEGORY_ICONS[rate.category] || "💳"}</span>
                <span>{CATEGORY_LABELS[rate.category]}</span>
                <span className="font-bold text-primary">{rate.multiplier}x</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
