import { EXTRACTOR_VERSIONS } from "./parserVersions";
import {
  CANCELLATION_LANGUAGE,
  OBLIGATION_CONTEXT,
  SUBSCRIPTION_CONTEXT,
  clauseAround,
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

  // Generic commerce messages also say "cancelled" and "cancellation
  // confirmed". A lifecycle fact requires the message to identify the thing
  // ending as a subscription or membership, not merely mention a payment,
  // plan, or billing footer elsewhere.
  if (!SUBSCRIPTION_CONTEXT.test(text)) return [];
  if (!CANCELLATION_LANGUAGE.test(text)) return [];

  const clause = clauseAround(input.textBody ?? "", CANCELLATION_LANGUAGE) ?? text;

  return [{
    type: "CANCELLATION",
    extractorId: CANCELLATION_EXTRACTOR_ID,
    extractorVersion: CANCELLATION_EXTRACTOR_VERSION,
    factKey: "",
    occurredAt: input.occurredAt,
    effectiveAt: firstDate(clause, input.occurredAt),
    evidenceSnippet: snippetAround(text, CANCELLATION_LANGUAGE),
  }];
}
