import { EXTRACTOR_VERSIONS } from "./parserVersions";
import {
  OBLIGATION_CONTEXT,
  TRIAL_ENDED_LANGUAGE,
  clauseAround,
  combineEmailText,
  firstDate,
  snippetAround,
  validDate,
  type EmailObligationFactInput,
  type ExtractedObligationFact,
} from "./factHelpers";

export const TRIAL_ENDED_EXTRACTOR_ID = "trial-ended";
export const TRIAL_ENDED_EXTRACTOR_VERSION =
  EXTRACTOR_VERSIONS[TRIAL_ENDED_EXTRACTOR_ID] ?? EXTRACTOR_VERSIONS.trial ?? 1;

/**
 * Extracts explicit notifications that a trial is ending or has expired.
 */
export function extractTrialEndedFacts(
  input: EmailObligationFactInput,
): ExtractedObligationFact[] {
  if (!validDate(input.occurredAt)) return [];
  const text = combineEmailText(input);
  if (!text || !OBLIGATION_CONTEXT.test(text)) return [];

  if (!TRIAL_ENDED_LANGUAGE.test(text)) return [];

  const clause = clauseAround(input.textBody ?? "", TRIAL_ENDED_LANGUAGE) ?? text;

  return [{
    type: "TRIAL_ENDED",
    extractorId: TRIAL_ENDED_EXTRACTOR_ID,
    extractorVersion: TRIAL_ENDED_EXTRACTOR_VERSION,
    factKey: "",
    occurredAt: input.occurredAt,
    effectiveAt: firstDate(clause, input.occurredAt),
    evidenceSnippet: snippetAround(text, TRIAL_ENDED_LANGUAGE),
  }];
}
