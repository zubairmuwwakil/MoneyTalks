// Persistence-shaped lifecycle facts, extracted where the decoded body is in
// hand. Each fact type has a dedicated pure extractor; ALL extractors run and
// their results are unioned.
//
// See docs/decisions/2026-08-30-email-fact-lane.md.

import { extractCadenceFacts } from "./extractCadenceFacts";
import { extractCancellationFacts } from "./extractCancellationFacts";
import { extractNextBillingFacts } from "./extractNextBillingFacts";
import { extractPriceChangeFacts } from "./extractPriceChangeFacts";
import { extractRecurringFacts } from "./extractRecurringFacts";
import { extractTrialEndedFacts } from "./extractTrialEndedFacts";
import { extractTrialStartedFacts } from "./extractTrialStartedFacts";
import type {
  EmailObligationFactInput,
  ExtractedObligationFact,
} from "./factHelpers";

export type {
  EmailObligationFactInput,
  EmailObligationFactType,
  ExtractedObligationFact,
} from "./factHelpers";

export { SNIPPET_MAX_CHARS } from "./factHelpers";
export { EXTRACTOR_VERSIONS } from "./parserVersions";

export const ALL_FACT_EXTRACTORS = Object.freeze([
  extractCadenceFacts,
  extractRecurringFacts,
  extractCancellationFacts,
  extractTrialStartedFacts,
  extractTrialEndedFacts,
  extractPriceChangeFacts,
  extractNextBillingFacts,
] as const);

/**
 * Run all email obligation fact extractors against the provided input and
 * union the results. Semantics are strictly union-all: no first-match-wins,
 * no ordering, and no scored dispatch.
 */
export function extractEmailObligationFacts(
  input: EmailObligationFactInput,
): ExtractedObligationFact[] {
  return ALL_FACT_EXTRACTORS.flatMap((extractor) => extractor(input));
}

/**
 * Derive the DetectedItem type from persisted EmailObligationFact rows.
 * TRIAL_STARTED and TRIAL_ENDED imply TRIAL.
 * EXPLICIT_CADENCE, EXPLICIT_RECURRING, and NEXT_BILLING_DATE imply RENEWAL.
 */
export function deriveSubscriptionDetectedItemType(
  facts: ReadonlyArray<{ type: string }>,
): "TRIAL" | "RENEWAL" | null {
  const types = new Set(facts.map((f) => f.type));
  if (types.has("TRIAL_STARTED") || types.has("TRIAL_ENDED")) {
    return "TRIAL";
  }
  if (
    types.has("EXPLICIT_CADENCE") ||
    types.has("EXPLICIT_RECURRING") ||
    types.has("NEXT_BILLING_DATE")
  ) {
    return "RENEWAL";
  }
  return null;
}

