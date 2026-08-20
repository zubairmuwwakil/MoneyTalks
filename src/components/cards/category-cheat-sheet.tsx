import Link from "next/link";
import { Sparkles, AlertTriangle, ArrowRight, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CheatSheetCategoryItem } from "@/lib/cards/cardPresentation";

export function CategoryCheatSheet({
  categories,
}: {
  categories: CheatSheetCategoryItem[];
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-tight">Optimal Spend Cheat Sheet</h2>
            <p className="text-xs text-muted-foreground">
              Calculated across your active cards, acceptance rules, point values, and category multiplier caps.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
          <span>Real-time catalogue scoring</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        {categories.map((cat) => (
          <div
            key={cat.id}
            className="flex flex-col justify-between rounded-xl border border-border/80 bg-card p-4 sm:p-5 shadow-2xs hover:shadow-xs transition-shadow space-y-3"
          >
            <div>
              {/* Category Header */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl" role="img" aria-label={cat.name}>
                    {cat.icon}
                  </span>
                  <span className="font-semibold text-sm text-foreground">{cat.name}</span>
                </div>
              </div>

              {/* Best Card Highlight */}
              <div className="mt-3 rounded-lg border border-border/70 bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Best Pick
                  </span>
                  <Badge variant="default" className="text-xs font-semibold tabular-nums">
                    {cat.bestCardRate}
                  </Badge>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  {cat.bestCardId ? (
                    <Link
                      href={`/cards/${cat.bestCardId}`}
                      className="font-bold text-sm text-foreground hover:underline flex items-center gap-1"
                    >
                      <span>{cat.bestCardName}</span>
                      <ArrowRight className="size-3 text-muted-foreground" />
                    </Link>
                  ) : (
                    <span className="font-medium text-sm text-muted-foreground">
                      {cat.bestCardName}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                  {cat.why}
                </p>
              </div>

              {/* Runner Up */}
              {cat.runnerUpCardName ? (
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground px-1">
                  <span>Runner-up: <span className="font-medium text-foreground">{cat.runnerUpCardName}</span></span>
                  <span className="font-mono text-[11px] tabular-nums">{cat.runnerUpCardRate}</span>
                </div>
              ) : null}

              {/* Caution / Retail notes */}
              {cat.cautionNote ? (
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/20">
                  <AlertTriangle className="size-3 shrink-0" />
                  <span>{cat.cautionNote}</span>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
