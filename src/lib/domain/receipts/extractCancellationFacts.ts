import { EXTRACTOR_VERSIONS } from "./parserVersions";
import {
  CANCELLATION_LANGUAGE,
  OBLIGATION_CONTEXT,
  combineEmailText,
  firstDate,
  snippetAround,
  validDate,
  type EmailObligationFactInput,
  type ExtractedObligationFact,
} from "./factHelpers";

export const CANCELLATION_EXTRACTOR_ID = "cancellation";
export const CANCELLATION_EXTRACTOR_VERSION = EXTRACTOR_VERSIONS[CANCELLATION_EXTRACTOR_ID] ?? 1;

/**
 * Extracts explicit subscription or membership cancellation notices and
 * their optional effective dates.
 */
export function extractCancellationFacts(
  input: EmailObligationFactInput,
): ExtractedObligationFact[] {
  if (!validDate(input.occurredAt)) return [];
  const text = combineEmailText(input);
  if (!text || !OBLIGATION_CONTEXT.test(text)) return [];

  if (!CANCELLATION_LANGUAGE.test(text)) return [];

  return [{
    type: "CANCELLATION",
    extractorId: CANCELLATION_EXTRACTOR_ID,
    extractorVersion: CANCELLATION_EXTRACTOR_VERSION,
    factKey: "",
    occurredAt: input.occurredAt,
    effectiveAt: firstDate(text, input.occurredAt),
    evidenceSnippet: snippetAround(text, CANCELLATION_LANGUAGE),
  }];
}
