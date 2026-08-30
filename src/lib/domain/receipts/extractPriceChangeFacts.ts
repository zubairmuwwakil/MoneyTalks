import { EXTRACTOR_VERSIONS } from "./parserVersions";
import {
  OBLIGATION_CONTEXT,
  PRICE_CHANGE_LANGUAGE,
  combineEmailText,
  firstDate,
  snippetAround,
  statedAmountMinor,
  validDate,
  type EmailObligationFactInput,
  type ExtractedObligationFact,
} from "./factHelpers";

export const PRICE_CHANGE_EXTRACTOR_ID = "price-change";
export const PRICE_CHANGE_EXTRACTOR_VERSION =
  EXTRACTOR_VERSIONS[PRICE_CHANGE_EXTRACTOR_ID] ?? 1;

/**
 * Extracts notifications of subscription price or rate changes, including
 * new amounts and effective dates when quoted.
 */
export function extractPriceChangeFacts(
  input: EmailObligationFactInput,
): ExtractedObligationFact[] {
  if (!validDate(input.occurredAt)) return [];
  const text = combineEmailText(input);
  if (!text || !OBLIGATION_CONTEXT.test(text)) return [];

  if (!PRICE_CHANGE_LANGUAGE.test(text)) return [];

  return [{
    type: "PRICE_CHANGE",
    extractorId: PRICE_CHANGE_EXTRACTOR_ID,
    extractorVersion: PRICE_CHANGE_EXTRACTOR_VERSION,
    factKey: "",
    occurredAt: input.occurredAt,
    effectiveAt: firstDate(text, input.occurredAt),
    amountMinor: statedAmountMinor(text),
    evidenceSnippet: snippetAround(text, PRICE_CHANGE_LANGUAGE),
  }];
}
