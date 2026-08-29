"use client";

import { useState } from "react";
import { Sparkles, Info, CheckCircle2, Circle, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  scoreBillRoutes,
  type RouteRecommendation,
} from "@/engine/billRouteScorer";
import type { BillIntermediary } from "@/lib/contracts/billIntermediaries";

interface SmartRewardRouterProps {
  payeeName: string;
  monthlyCad?: number;
  ownedCardIds?: (string | null | undefined)[];
  selectedRouteId?: string;
  onSelectRoute?: (route: RouteRecommendation) => void;
}

export function SmartRewardRouter({
  payeeName,
  monthlyCad = 150,
  ownedCardIds = ["scotiabank-momentum-vi", "triangle-we"],
  selectedRouteId,
  onSelectRoute,
}: SmartRewardRouterProps) {
  const [internalSelectedId, setInternalSelectedId] = useState<string>("");
  const [activeIntermediary, setActiveIntermediary] = useState<BillIntermediary | null>(null);

  const cleanOwnedCardIds = (ownedCardIds ?? []).filter((id): id is string => Boolean(id));

  const routes = scoreBillRoutes({
    payeeName,
    monthlyCad,
    ownedCardIds: cleanOwnedCardIds,
  });

  const currentSelectedId = selectedRouteId || internalSelectedId || routes[0]?.id;

  const handleSelect = (route: RouteRecommendation) => {
    setInternalSelectedId(route.id);
    onSelectRoute?.(route);
  };

  if (!payeeName.trim()) {
    return null;
  }

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.02] p-4 sm:p-5 shadow-2xs space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Smart Reward Router (Canadian Rails)
          </h2>
        </div>
        <Badge variant="outline" className="text-[10px] font-semibold text-primary border-primary/30">
          PickMe Net Spread Engine
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground">
        We evaluated municipal bill pay rules against your wallet to rank the most profitable payment rails after fees:
      </p>

      {/* Routes Grid */}
      <div className="space-y-2.5">
        {routes.map((route) => {
          const isSelected = currentSelectedId === route.id;

          return (
            <div
              key={route.id}
              onClick={() => handleSelect(route)}
              className={`group relative flex flex-col justify-between gap-3 rounded-lg border p-3.5 transition-all cursor-pointer ${
                isSelected
                  ? "border-primary bg-primary/5 shadow-2xs"
                  : "border-border/80 bg-card hover:border-border hover:bg-muted/30"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="text-primary focus:outline-none"
                      aria-label={isSelected ? "Selected" : "Select"}
                    >
                      {isSelected ? (
                        <CheckCircle2 className="size-4 fill-primary text-primary-foreground" />
                      ) : (
                        <Circle className="size-4 text-muted-foreground group-hover:text-foreground" />
                      )}
                    </button>
                    <span className="text-sm font-semibold text-foreground">
                      {route.intermediary.name}
                    </span>
                    {route.isOptimal ? (
                      <Badge className="bg-emerald-600 text-white text-[9px] uppercase px-1.5 py-0 font-bold hover:bg-emerald-600">
                        Top Net Spread
                      </Badge>
                    ) : null}
                  </div>

                  {route.cardOfficialName ? (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-6">
                      <Wallet className="size-3" />
                      <span>{route.cardOfficialName}</span>
                    </div>
                  ) : null}
                </div>

                <div className="text-right">
                  {route.estimatedAnnualNetCad > 0 ? (
                    <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                      +${route.estimatedAnnualNetCad.toFixed(2)}/yr
                    </span>
                  ) : (
                    <span className="text-sm font-medium text-muted-foreground">
                      $0.00
                    </span>
                  )}
                  <p className="text-[10px] text-muted-foreground/80">
                    {route.mathBreakdown}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-muted-foreground pl-6 pt-1 border-t border-border/40">
                <span className="line-clamp-1">{route.instruction}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveIntermediary(route.intermediary);
                  }}
                  className="inline-flex items-center gap-1 text-primary hover:underline font-medium shrink-0 ml-2"
                >
                  <Info className="size-3" />
                  <span>How it works</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal / Dialog for Intermediary Details */}
      {activeIntermediary ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="text-base font-bold text-foreground">
                {activeIntermediary.name}
              </h3>
              <button
                type="button"
                onClick={() => setActiveIntermediary(null)}
                className="text-xs text-muted-foreground hover:text-foreground font-semibold px-2 py-1 rounded-md"
              >
                ✕ Close
              </button>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              {activeIntermediary.description}
            </p>

            <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Processing Fee:</span>
                <span className="font-semibold text-foreground">
                  {(activeIntermediary.feeRate * 100).toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Settlement Speed:</span>
                <span className="font-semibold text-foreground">
                  {activeIntermediary.settlementDays} business days
                </span>
              </div>
              {activeIntermediary.mccTrigger ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">MCC Multiplier:</span>
                  <span className="font-semibold text-primary">
                    {activeIntermediary.mccTrigger}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setActiveIntermediary(null)}
                className="w-full rounded-lg bg-primary py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
