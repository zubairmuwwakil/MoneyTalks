import { EXTRACTOR_VERSIONS } from "./parserVersions";
import {
  CADENCE_WORD,
  OBLIGATION_CONTEXT,
  combineEmailText,
  snippetAround,
  statedCadence,
  validDate,
  type EmailObligationFactInput,
  type ExtractedObligationFact,
} from "./factHelpers";

export const CADENCE_EXTRACTOR_ID = "cadence";
export const CADENCE_EXTRACTOR_VERSION = EXTRACTOR_VERSIONS[CADENCE_EXTRACTOR_ID] ?? 1;

const CADENCE_OPERATION = /\b(renew(?:al|s|ing)?|bill(?:ed|ing)?|charg(?:e|ed|ing)|payment)\b/i;

/**
 * Extracts explicit stated billing cadence (e.g. monthly, annually, weekly)
 * when paired with operational billing or renewal keywords.
 */
export function extractCadenceFacts(
  input: EmailObligationFactInput,
): ExtractedObligationFact[] {
  if (!validDate(input.occurredAt)) return [];
  const text = combineEmailText(input);
  if (!text || !OBLIGATION_CONTEXT.test(text)) return [];

  const cadence = statedCadence(text);
  if (!cadence || !CADENCE_OPERATION.test(text)) return [];

  return [{
    type: "EXPLICIT_CADENCE",
    extractorId: CADENCE_EXTRACTOR_ID,
    extractorVersion: CADENCE_EXTRACTOR_VERSION,
    factKey: "",
    occurredAt: input.occurredAt,
    cadence,
    evidenceSnippet: snippetAround(text, CADENCE_WORD),
  }];
}
