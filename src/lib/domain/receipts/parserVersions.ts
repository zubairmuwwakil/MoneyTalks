/** Increment when a parser's output semantics change and existing projections
 * need an intentional replay. */
export const GMAIL_RECEIPT_PARSER_VERSION = 1;
export const RECEIPT_UPLOAD_EXTRACTOR_VERSION = 1;

/**
 * Versioned per extractor, never globally: a change to an individual extractor
 * allows that extractor alone to be re-run and measured, rather than forcing
 * every message in the mailbox through full re-extraction.
 */
export const EXTRACTOR_VERSIONS: Readonly<Record<string, number>> = Object.freeze({
  cadence: 1,
  recurring: 1,
  cancellation: 1,
  "trial-started": 1,
  "trial-ended": 1,
  trial: 1,
  "price-change": 1,
  "next-billing": 1,
});
