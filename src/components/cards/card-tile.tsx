import Link from "next/link";
import { ChevronRight, Edit2, Shield, Gift, AlertCircle, FileSpreadsheet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatMinorUnits, type Currency } from "@/engine/money";
import { FeeCycleNote } from "@/components/fee-cycle-note";
import type { FeeCycle } from "@/lib/cards/feeSchedule";
import {
  getCardBranding,
  getCardEarnHighlights,
  getCardInsuranceHighlights,
} from "@/lib/cards/cardPresentation";
import { catalogueCard, catalogueCredits } from "@/lib/cards/catalogueCard";
import { CardImage } from "@/components/cards/card-image";

export interface CardTileData {
  id: string;
  nickname: string;
  issuer: string;
  network: string;
  lastFour: string | null;
  currency: string;
  annualFeeMinor: number;
  feeRebateMinor: number;
  contractCardId: string | null;
  feeMonthDay: string | null;
  feeCancelGraceDays: number;
  coveragePercentage?: number | null;
}

export function CardTile({
  card,
  feeCycle,
  today,
  onSetRenewalDate,
}: {
  card: CardTileData;
  feeCycle: FeeCycle | null;
  today: Date;
  onSetRenewalDate?: () => void;
}) {
  const effectiveFee = Math.max(0, card.annualFeeMinor - card.feeRebateMinor);
  const branding = getCardBranding(card.network, card.issuer, card.nickname, card.contractCardId);
  const product = catalogueCard(card.contractCardId);
  const earnHighlights = getCardEarnHighlights(product);
  const insuranceHighlights = getCardInsuranceHighlights(card.contractCardId);
  const credits = catalogueCredits(card.contractCardId);
  const totalCreditsCad = credits.reduce((sum, c) => sum + c.valueCad, 0);

  const isFeeCard = effectiveFee > 0;
  const isMissingRenewal = isFeeCard && !card.feeMonthDay;

  return (
    <div
      className={`group relative flex flex-col justify-between rounded-xl border ${branding.borderClass} bg-gradient-to-b ${branding.bgGradient} bg-card p-5 shadow-xs transition-all duration-200 hover:shadow-md hover:border-foreground/25`}
    >
      {/* Top Identity Row */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <Link
              href={`/cards/${card.id}`}
              className="shrink-0 transition-transform group-hover:scale-105"
            >
              <CardImage
                contractCardId={card.contractCardId}
                nickname={card.nickname}
                issuer={card.issuer}
                network={card.network}
                lastFour={card.lastFour}
                size="avatar"
              />
            </Link>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/cards/${card.id}`}
                  className="font-bold text-base text-foreground tracking-tight hover:underline underline-offset-2 flex items-center gap-1.5"
                >
                  <span className="truncate">{card.nickname}</span>
                  <ChevronRight className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </Link>
                <Badge variant="outline" className={`text-[10px] font-mono font-semibold ${branding.badgeClass}`}>
                  {card.network}
                </Badge>
                {card.lastFour ? (
                  <span className="text-[11px] font-mono text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                    •••• {card.lastFour}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {card.issuer} {product?.kind ? `· ${product.kind} card` : ""}
              </p>
            </div>
          </div>

          {/* Annual Fee & Renewal Status */}
          <div className="text-right shrink-0">
            <div className="text-sm font-semibold tabular-nums text-foreground">
              {effectiveFee === 0 ? (
                <span className="text-muted-foreground font-normal">No annual fee</span>
              ) : (
                <span>
                  {formatMinorUnits(effectiveFee, "CAD")}
                  <span className="text-xs font-normal text-muted-foreground">/yr</span>
                </span>
              )}
            </div>
            {effectiveFee !== card.annualFeeMinor ? (
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block tabular-nums">
                ({formatMinorUnits(card.annualFeeMinor - card.feeRebateMinor, "CAD")} bank rebate)
              </span>
            ) : null}
          </div>
        </div>

        {/* Renewal & Grace Period Badge */}
        {feeCycle ? (
          <div className="pt-1">
            <FeeCycleNote cycle={feeCycle} today={today} currency={card.currency as Currency} />
          </div>
        ) : isMissingRenewal ? (
          <div className="pt-1">
            <button
              onClick={onSetRenewalDate}
              className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline underline-offset-2"
            >
              <AlertCircle className="size-3" />
              <span>No renewal date set · Click to add</span>
            </button>
          </div>
        ) : null}

        {/* Earn Multiplier Badges */}
        {earnHighlights.length > 0 ? (
          <div className="pt-2 border-t border-border/40">
            <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground mb-1.5">
              Top Earn Rates
            </p>
            <div className="flex flex-wrap gap-1.5">
              {earnHighlights.map((h, idx) => (
                <span
                  key={idx}
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${
                    h.isTop
                      ? "bg-foreground/10 text-foreground font-semibold"
                      : "bg-muted/80 text-muted-foreground"
                  }`}
                >
                  <span className="font-semibold tabular-nums text-foreground">{h.rate}</span>
                  <span className="text-[11px]">{h.label}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {/* Statement Credits / Perks */}
        {totalCreditsCad > 0 ? (
          <div className="pt-1.5">
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <Gift className="size-3.5 shrink-0" />
              <span className="font-medium">${totalCreditsCad.toFixed(0)}/yr credits:</span>
              <span className="text-muted-foreground text-[11px]">
                {credits.map((c) => `${c.label} ($${c.valueCad})`).join(" · ")}
              </span>
            </div>
          </div>
        ) : null}

        {/* Insurance & Protection Badges */}
        {insuranceHighlights.length > 0 ? (
          <div className="pt-1 flex flex-wrap items-center gap-1.5">
            <Shield className="size-3 text-muted-foreground/70" />
            {insuranceHighlights.map((ins, idx) => (
              <span
                key={idx}
                className="text-[11px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded border border-border/40"
              >
                {ins.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Footer Details & Actions */}
      <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
        <div>
          {typeof card.coveragePercentage === "number" ? (
            <span className="inline-flex items-center gap-1 text-[11px]">
              <FileSpreadsheet className="size-3 text-muted-foreground" />
              <span>Capture coverage: {Math.round(card.coveragePercentage)}%</span>
            </span>
          ) : (
            <span className="text-[11px]">
              {product ? `Verified ${product.lastVerifiedAt}` : "Custom card entry"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Link
            href={`/cards/${card.id}/edit`}
            className="flex items-center gap-1 hover:text-foreground transition-colors text-[11px]"
            title="Edit this card"
          >
            <Edit2 className="size-3" />
            <span>Edit</span>
          </Link>
          <Link
            href={`/cards/${card.id}`}
            className="flex items-center gap-1 font-medium text-foreground hover:underline transition-colors text-[11px]"
          >
            <span>View Details</span>
            <ChevronRight className="size-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
