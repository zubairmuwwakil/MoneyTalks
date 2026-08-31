import { EXTRACTOR_VERSIONS } from "./parserVersions";
import {
  OBLIGATION_CONTEXT,
  TRIAL_STARTED_LANGUAGE,
  clauseAround,
  combineEmailText,
  firstDate,
  snippetAround,
  validDate,
  type EmailObligationFactInput,
  type ExtractedObligationFact,
} from "./factHelpers";

export const TRIAL_STARTED_EXTRACTOR_ID = "trial-started";
export const TRIAL_STARTED_EXTRACTOR_VERSION =
  EXTRACTOR_VERSIONS[TRIAL_STARTED_EXTRACTOR_ID] ?? EXTRACTOR_VERSIONS.trial ?? 1;

/**
 * Extracts explicit notifications that a free or promotional trial has started.
 */
export function extractTrialStartedFacts(
  input: EmailObligationFactInput,
): ExtractedObligationFact[] {
  if (!validDate(input.occurredAt)) return [];
  const text = combineEmailText(input);
  if (!text || !OBLIGATION_CONTEXT.test(text)) return [];

  if (!TRIAL_STARTED_LANGUAGE.test(text)) return [];

  const clause = clauseAround(input.textBody ?? "", TRIAL_STARTED_LANGUAGE) ?? text;

  return [{
    type: "TRIAL_STARTED",
    extractorId: TRIAL_STARTED_EXTRACTOR_ID,
    extractorVersion: TRIAL_STARTED_EXTRACTOR_VERSION,
    factKey: "",
    occurredAt: input.occurredAt,
    effectiveAt: firstDate(clause, input.occurredAt),
    evidenceSnippet: snippetAround(text, TRIAL_STARTED_LANGUAGE),
  }];
}
