import Link from "next/link";
import { HelpCircle, Sparkles } from "lucide-react";
import { InlineCategoryPicker } from "./InlineCategoryPicker";

export interface ReviewRow {
  id: string;
  merchant: string;
  rawString: string;
  amountLabel: string;
  dateLabel: string;
  suggestion: { category: string; rationale: string } | null;
}

/**
 * The uncategorized backlog, cleared in place.
 *
 * Two things make this an inbox rather than another list. Rows carry their
 * own suggestion, so the common case is one tap and no navigation. And every
 * tap trains the global alias, so clearing this queue is also what stops the
 * next purchase from that merchant ever arriving here — the backlog shrinks
 * faster than it is worked.
 *
 * Suggestion-bearing rows sort first for exactly that reason: they are the
 * cheapest to clear and the most valuable to have cleared.
 */
export function NeedsReviewQueue({ rows, totalCount }: { rows: ReviewRow[]; totalCount: number }) {
  if (rows.length === 0) return null;

  const withSuggestion = rows.filter((row) => row.suggestion !== null).length;
  const remaining = totalCount - rows.length;

  return (
    <section
      aria-labelledby="needs-review-heading"
      className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-2xs space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <HelpCircle className="size-5" />
          </div>
          <div>
            <h2
              id="needs-review-heading"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Needs review
            </h2>
            <p className="text-sm font-bold text-foreground">
              {totalCount} purchase{totalCount === 1 ? "" : "s"} without a category
            </p>
            <p className="text-xs text-muted-foreground">
              {withSuggestion > 0 ? (
                <>
                  <Sparkles className="mb-0.5 mr-1 inline size-3 text-primary" />
                  {withSuggestion} can be cleared in one tap. Confirming teaches the merchant
                  for every future purchase.
                </>
              ) : (
                <>Categorizing one purchase categorizes every purchase from that merchant.</>
              )}
            </p>
          </div>
        </div>
        <Link
          href="/purchases?category=uncategorized"
          className="text-xs font-medium text-primary hover:underline"
        >
          See all
        </Link>
      </div>

      <ul className="divide-y divide-border/60">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
            <Link
              href={`/purchases/${row.id}`}
              className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:text-primary transition-colors"
            >
              {row.merchant}
            </Link>
            <span className="text-xs tabular-nums text-muted-foreground">{row.dateLabel}</span>
            <span className="text-xs font-semibold tabular-nums text-foreground">{row.amountLabel}</span>
            <InlineCategoryPicker
              rawString={row.rawString}
              currentCategory={null}
              suggestion={row.suggestion}
              variant="badge"
            />
          </li>
        ))}
      </ul>

      {remaining > 0 ? (
        <p className="text-xs text-muted-foreground">
          {remaining} more below.
        </p>
      ) : null}
    </section>
  );
}
