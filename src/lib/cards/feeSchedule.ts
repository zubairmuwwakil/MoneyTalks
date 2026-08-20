import { addDaysUTC, clampDayToMonth, startOfDayUTC } from "@/lib/utils/dates";
import { effectiveAnnualFeeMinor } from "./catalogueCard";
import type { CardDef } from "./types";

/**
 * Annual-fee decision timing. The question this answers is not "when does the
 * fee renew" but "how long do I have left to cancel and get it back" — most
 * issuers refund the fee if the card is closed within a window after it posts.
 *
 * Spec: docs/superpowers/specs/2026-08-18-annual-fee-renewal-calendar-design.md §5.
 */

export type FeeCyclePhase = "UPCOMING" | "DECISION_WINDOW";

export interface FeeCycle {
  /** The anniversary this cycle is anchored to (UTC midnight). */
  postsOn: Date;
  /** Last day the fee can still be recovered by cancelling. Inclusive. */
  cancelBy: Date;
  /** Effective fee, after any active waiver conditions. Always > 0. */
  feeMinor: number;
  phase: FeeCyclePhase;
}

/** A card plus the two owner-state columns that carry its fee timing. */
export type FeeScheduleCard = CardDef & {
  feeMonthDay: string | null;
  feeCancelGraceDays: number;
};

const MONTH_DAY = /^(\d{2})-(\d{2})$/;

/**
 * The fee cycle the user is currently living in, or null when there is no
 * decision to surface — the date is unknown, or the effective fee is zero.
 */
export function currentFeeCycle(card: FeeScheduleCard, today: Date): FeeCycle | null {
  if (!card.feeMonthDay) return null;

  const match = MONTH_DAY.exec(card.feeMonthDay);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const feeMinor = effectiveAnnualFeeMinor(card.annualFeeMinor, card.feeRebateMinor);
  if (feeMinor <= 0) return null;

  const todayUTC = startOfDayUTC(today);
  const thisYear = todayUTC.getUTCFullYear();

  // The cycle advances when the grace window CLOSES, not when the fee posts —
  // otherwise the countdown vanishes the moment it starts mattering. A window
  // can also run past New Year, so last year's anniversary is a live
  // candidate: walk from the earliest and take the first still open.
  for (const year of [thisYear - 1, thisYear, thisYear + 1]) {
    const postsOn = new Date(Date.UTC(year, month - 1, clampDayToMonth(year, month - 1, day)));
    const cancelBy = addDaysUTC(postsOn, card.feeCancelGraceDays);
    if (cancelBy >= todayUTC) {
      return {
        postsOn,
        cancelBy,
        feeMinor,
        phase: todayUTC >= postsOn ? "DECISION_WINDOW" : "UPCOMING",
      };
    }
  }

  return null;
}

const MS_PER_DAY = 86_400_000;

/**
 * Whole days until the moment that matters for this phase: the posting date
 * while UPCOMING, the cancel deadline once inside the window. Zero means
 * "today is the last day", never "already gone" — a closed window would have
 * rolled the cycle forward.
 */
export function feeCycleDaysRemaining(cycle: FeeCycle, today: Date): number {
  const target = cycle.phase === "UPCOMING" ? cycle.postsOn : cycle.cancelBy;
  return Math.round((target.getTime() - startOfDayUTC(today).getTime()) / MS_PER_DAY);
}
