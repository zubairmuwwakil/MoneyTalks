// Persistence-shaped lifecycle facts, extracted where the decoded body is in
// hand. `extractEmailSignals` already decides WHAT an email states; this module
// adds the two things persistence needs and the sweep cannot recover later —
// the quote that justifies each fact, and a key that keeps two facts of one
// type on one message from collapsing into each other.
//
// See docs/decisions/2026-08-30-email-fact-lane.md.

import {
  CADENCE_WORD,
  CANCELLATION_LANGUAGE,
  NEXT_BILLING_LANGUAGE,
  PRICE_CHANGE_LANGUAGE,
  RECURRING_LANGUAGE,
  TRIAL_ENDED_LANGUAGE,
  TRIAL_STARTED_LANGUAGE,
  extractEmailSignals,
} from "@/lib/domain/recurring/emailSignals";
import type { ObligationFact } from "@/lib/domain/recurring/types";

export type EmailObligationFactType = Exclude<ObligationFact["type"], "CHARGE">;

export interface ExtractedObligationFact {
  type: EmailObligationFactType;
  /** Stable across extractor versions; identifies which extractor spoke. */
  extractorId: string;
  extractorVersion: number;
  /** Empty for the ordinary one-fact-per-type message. */
  factKey: string;
  occurredAt: Date;
  effectiveAt?: Date;
  billingAt?: Date;
  amountMinor?: number;
  cadence?: string;
  evidenceSnippet: string;
}

export interface EmailObligationFactInput {
  subject?: string | null;
  textBody?: string | null;
  occurredAt: Date;
}

/**
 * Wide enough that a human can see the merchant's own sentence, narrow enough
 * that it is a quote rather than a copy of the message.
 */
export const SNIPPET_MAX_CHARS = 200;

/**
 * URLs are the one part of a body that identifies the RECIPIENT rather than the
 * subject matter: tracking pixels and unsubscribe links carry per-recipient
 * tokens. They are removed before the window is chosen, not after, so a stripped
 * link cannot push the sentence out of frame.
 */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/gi;

const PATTERN_BY_TYPE: Readonly<Record<EmailObligationFactType, RegExp>> = Object.freeze({
  EXPLICIT_CADENCE: CADENCE_WORD,
  EXPLICIT_RECURRING: RECURRING_LANGUAGE,
  CANCELLATION: CANCELLATION_LANGUAGE,
  TRIAL_STARTED: TRIAL_STARTED_LANGUAGE,
  TRIAL_ENDED: TRIAL_ENDED_LANGUAGE,
  PRICE_CHANGE: PRICE_CHANGE_LANGUAGE,
  NEXT_BILLING_DATE: NEXT_BILLING_LANGUAGE,
});

const EXTRACTOR_ID_BY_TYPE: Readonly<Record<EmailObligationFactType, string>> = Object.freeze({
  EXPLICIT_CADENCE: "cadence",
  EXPLICIT_RECURRING: "recurring",
  CANCELLATION: "cancellation",
  TRIAL_STARTED: "trial",
  TRIAL_ENDED: "trial",
  PRICE_CHANGE: "price-change",
  NEXT_BILLING_DATE: "next-billing",
});

/**
 * Versioned per extractor, never globally: a change to the price-change wording
 * should let that one extractor be re-run and measured, not force every message
 * in the mailbox through re-extraction.
 */
export const EXTRACTOR_VERSIONS: Readonly<Record<string, number>> = Object.freeze({
  cadence: 1,
  recurring: 1,
  cancellation: 1,
  trial: 1,
  "price-change": 1,
  "next-billing": 1,
});

function normalizeForSnippet(text: string): string {
  return text.replace(URL_PATTERN, " ").replace(/\s+/g, " ").trim();
}

function snippetAround(text: string, pattern: RegExp): string {
  const clean = normalizeForSnippet(text);
  const match = clean.match(pattern);
  if (!match || match.index === undefined) return clean.slice(0, SNIPPET_MAX_CHARS);

  const centre = match.index + Math.floor(match[0].length / 2);
  const start = Math.max(0, Math.min(centre - SNIPPET_MAX_CHARS / 2, clean.length - SNIPPET_MAX_CHARS));
  return clean.slice(Math.max(0, start), Math.max(0, start) + SNIPPET_MAX_CHARS);
}

export function extractEmailObligationFacts(
  input: EmailObligationFactInput,
): ExtractedObligationFact[] {
  const text = `${input.subject ?? ""}\n${input.textBody ?? ""}`;
  const signals = extractEmailSignals([{
    subject: input.subject,
    textBody: input.textBody,
    purchasedAt: input.occurredAt,
  }]);

  return signals.flatMap((fact) => {
    if (fact.type === "CHARGE") return [];
    const extractorId = EXTRACTOR_ID_BY_TYPE[fact.type];
    return [{
      type: fact.type,
      extractorId,
      extractorVersion: EXTRACTOR_VERSIONS[extractorId],
      factKey: "",
      occurredAt: fact.occurredAt,
      effectiveAt: "effectiveAt" in fact ? fact.effectiveAt : undefined,
      billingAt: fact.type === "NEXT_BILLING_DATE" ? fact.billingAt : undefined,
      amountMinor: fact.type === "PRICE_CHANGE" ? fact.amountMinor : undefined,
      cadence: fact.type === "EXPLICIT_CADENCE" ? fact.cadence : undefined,
      evidenceSnippet: snippetAround(text, PATTERN_BY_TYPE[fact.type]),
    }];
  });
}
