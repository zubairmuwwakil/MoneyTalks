import { EXTRACTOR_VERSIONS } from "./parserVersions";
import {
  OBLIGATION_CONTEXT,
  RECURRING_LANGUAGE,
  combineEmailText,
  snippetAround,
  validDate,
  type EmailObligationFactInput,
  type ExtractedObligationFact,
} from "./factHelpers";

export const RECURRING_EXTRACTOR_ID = "recurring";
export const RECURRING_EXTRACTOR_VERSION = EXTRACTOR_VERSIONS[RECURRING_EXTRACTOR_ID] ?? 1;

/**
 * Extracts explicit statements that an agreement is recurring or auto-renewing.
 */
export function extractRecurringFacts(
  input: EmailObligationFactInput,
): ExtractedObligationFact[] {
  if (!validDate(input.occurredAt)) return [];
  const text = combineEmailText(input);
  if (!text || !OBLIGATION_CONTEXT.test(text)) return [];

  if (!RECURRING_LANGUAGE.test(text)) return [];

  return [{
    type: "EXPLICIT_RECURRING",
    extractorId: RECURRING_EXTRACTOR_ID,
    extractorVersion: RECURRING_EXTRACTOR_VERSION,
    factKey: "",
    occurredAt: input.occurredAt,
    evidenceSnippet: snippetAround(text, RECURRING_LANGUAGE),
  }];
}
