import { Money } from './models';

/// Converts a `Money` value into the engine's fixed reporting currency.
///
/// Mirrors the Swift/Kotlin twins (`Engine/Sources/CardCopilotEngine/Models/ReportingCurrency.swift`,
/// `android/core/engine/.../models/ReportingCurrency.kt`) — see their doc comments for the full
/// reasoning. In short: this engine reports every cross-card number in CAD regardless of a card's
/// own `market`/`billingCurrency`, so a USD fee (or a USD-valued program, later) needs to become
/// one CAD number before it can be combined with a CAD one. The rate is pinned, not live — this
/// repo does not own market data (ECOSYSTEM.md).
export const REPORTING_CURRENCY = 'CAD' as const;

/// == 1 / Scorer.fallbackCadToUsd. Duplicated as a literal rather than imported from Scorer to
/// avoid a circular module dependency (Scorer imports `toReporting` from this file); kept in
/// sync deliberately, and `reportingCurrency.test.ts` asserts the two never drift apart.
export const PINNED_USD_TO_CAD = 1 / 0.73;

/// `money`'s amount, converted to the reporting currency. `undefined`/`null` reports as 0,
/// matching the `?? 0` callers used before `Fee.annual`/`monthly` existed.
export function toReporting(money: Money | null | undefined): number {
  if (!money) return 0;
  switch (money.currency) {
    case 'CAD':
      return money.amount;
    case 'USD':
      return money.amount * PINNED_USD_TO_CAD;
  }
}
