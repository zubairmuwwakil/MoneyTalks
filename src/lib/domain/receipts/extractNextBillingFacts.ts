import { EXTRACTOR_VERSIONS } from "./parserVersions";
import {
  NEXT_BILLING_LANGUAGE,
  OBLIGATION_CONTEXT,
  combineEmailText,
  firstDate,
  snippetAround,
  validDate,
  type EmailObligationFactInput,
  type ExtractedObligationFact,
} from "./factHelpers";

export const NEXT_BILLING_EXTRACTOR_ID = "next-billing";
export const NEXT_BILLING_EXTRACTOR_VERSION =
  EXTRACTOR_VERSIONS[NEXT_BILLING_EXTRACTOR_ID] ?? 1;

/**
 * Extracts stated upcoming billing dates (e.g. next bill date, will be billed on).
 * Emits a fact only when a concrete date could be resolved.
 */
export function extractNextBillingFacts(
  input: EmailObligationFactInput,
): ExtractedObligationFact[] {
  if (!validDate(input.occurredAt)) return [];
  const text = combineEmailText(input);
  if (!text || !OBLIGATION_CONTEXT.test(text)) return [];

  if (!NEXT_BILLING_LANGUAGE.test(text)) return [];

  const billingAt = firstDate(text, input.occurredAt);
  if (!billingAt) return [];

  return [{
    type: "NEXT_BILLING_DATE",
    extractorId: NEXT_BILLING_EXTRACTOR_ID,
    extractorVersion: NEXT_BILLING_EXTRACTOR_VERSION,
    factKey: "",
    occurredAt: input.occurredAt,
    billingAt,
    evidenceSnippet: snippetAround(text, NEXT_BILLING_LANGUAGE),
  }];
}
