import type { Cadence } from "@/engine/recurrence";
import type { ObligationFact } from "@/lib/domain/recurring/types";

// Owner-only lifecycle facts are deliberately not email extractors.
export type EmailObligationFactType = Exclude<ObligationFact["type"], "CHARGE" | "ACTIVATION" | "RESUMPTION">;

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

export const SNIPPET_MAX_CHARS = 200;

/**
 * URLs are the one part of a body that identifies the RECIPIENT rather than the
 * subject matter: tracking pixels and unsubscribe links carry per-recipient
 * tokens. They are removed before the window is chosen, not after, so a stripped
 * link cannot push the sentence out of frame.
 */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/gi;

const MONTHS: Readonly<Record<string, number>> = Object.freeze({
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
});

export const CADENCE_BY_WORD: Readonly<Record<string, Cadence["type"]>> = Object.freeze({
  weekly: "WEEKLY",
  biweekly: "BIWEEKLY",
  fortnightly: "BIWEEKLY",
  monthly: "MONTHLY",
  quarterly: "QUARTERLY",
  semiannual: "SEMIANNUAL",
  "semi-annual": "SEMIANNUAL",
  yearly: "ANNUAL",
  annual: "ANNUAL",
  annually: "ANNUAL",
});

export const CADENCE_WORD = /\b(weekly|biweekly|fortnightly|monthly|quarterly|semi-?annual|yearly|annually)\b/i;
export const OBLIGATION_CONTEXT = /\b(subscription|membership|plan|renew(?:al|s|ing)?|billing|bill(?:ed|ing)?|payment|invoice|statement|trial)\b/i;
export const RECURRING_LANGUAGE = /\b(auto-?renew(?:al|s|ing)?|recurring|renews? automatically)\b/i;
export const CANCELLATION_LANGUAGE = /\b(cancel(?:led|ed)|cancellation (?:is )?(?:confirmed|complete)|subscription (?:has |will )?end(?:ed|s)?)\b/i;
export const TRIAL_STARTED_LANGUAGE = /\btrial (?:has )?(?:started|begun|begins|starts)\b/i;
export const TRIAL_ENDED_LANGUAGE = /\btrial (?:has )?(?:ended|expires?|is ending)\b/i;
export const PRICE_CHANGE_LANGUAGE = /\b(?:price|rate) (?:has |will )?(?:increase|increased|change|changed)|\b(?:new|updated) (?:price|rate)\b/i;
export const NEXT_BILLING_LANGUAGE = /\b(?:next (?:billing date|bill|payment|charge|renewal)|will be (?:billed|charged)|next (?:payment|charge) (?:is )?due)\b/i;

const DATE_PATTERN = /\b(\d{4})-(\d{2})-(\d{2})\b|\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i;
const MONEY_PATTERN = /(?:CAD|USD|EUR|GBP|CA\$|Can\$|\$)\s*([0-9][0-9,]*(?:\.\d{2})?)/i;

export function validDate(date: Date | null | undefined): date is Date {
  return date instanceof Date && Number.isFinite(date.getTime());
}

export function normalizeForSnippet(text: string): string {
  return text.replace(URL_PATTERN, " ").replace(/\s+/g, " ").trim();
}

export function snippetAround(text: string, pattern: RegExp): string {
  const clean = normalizeForSnippet(text);
  const match = clean.match(pattern);
  if (!match || match.index === undefined) return clean.slice(0, SNIPPET_MAX_CHARS);

  const centre = match.index + Math.floor(match[0].length / 2);
  const start = Math.max(0, Math.min(centre - SNIPPET_MAX_CHARS / 2, clean.length - SNIPPET_MAX_CHARS));
  return clean.slice(Math.max(0, start), Math.max(0, start) + SNIPPET_MAX_CHARS);
}

/**
 * A period that ends a sentence, rather than one inside "$29.99" or "Sep. 2".
 */
const MONTH_ABBREVIATION = /(?:^|\s)(?:jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)$/i;

function isTerminator(text: string, at: number): boolean {
  const character = text[at];
  if (character === "\n") return true;
  if (character !== "." && character !== "!" && character !== "?") return false;
  if (character === ".") {
    const before = text[at - 1];
    const after = text[at + 1];
    if (before >= "0" && before <= "9" && after >= "0" && after <= "9") return false;
    if (MONTH_ABBREVIATION.test(text.slice(Math.max(0, at - 6), at))) return false;
  }
  return true;
}

/**
 * The sentence that states the fact, not the whole message.
 *
 * A fact is asserted in a clause: "your price will increase to $29.99 on
 * October 1" is one claim, and a "$9.99" two sentences earlier is a different
 * one. Searching the entire body for an amount or a date finds the wrong one
 * on any email that mentions two — and a price-change notice mentions two by
 * definition, because it quotes what you pay now.
 *
 * Returns undefined when `text` does not state the fact at all, so a caller can
 * fall back. Callers pass the BODY: a subject is a headline, and narrowing to it
 * would discard the date the body goes on to give.
 */
export function clauseAround(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern);
  if (!match || match.index === undefined) return undefined;

  let start = 0;
  for (let at = match.index - 1; at >= 0; at -= 1) {
    if (isTerminator(text, at)) { start = at + 1; break; }
  }
  let end = text.length;
  for (let at = match.index + match[0].length; at < text.length; at += 1) {
    if (isTerminator(text, at)) { end = at; break; }
  }
  return text.slice(start, end).trim();
}

export function firstDate(text: string, relativeTo: Date): Date | undefined {
  const match = text.match(DATE_PATTERN);
  if (!match) return undefined;

  if (match[1]) {
    const candidate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
    return Number.isFinite(candidate.getTime()) ? candidate : undefined;
  }

  const month = MONTHS[match[4].toLowerCase().replace(".", "")];
  const day = Number(match[5]);
  const suppliedYear = match[6] ? Number(match[6]) : undefined;
  if (month === undefined || !Number.isInteger(day) || day < 1 || day > 31) return undefined;

  const base = new Date(relativeTo.getTime());
  const year = suppliedYear ?? base.getUTCFullYear();
  let candidate = new Date(Date.UTC(year, month, day, 12));
  if (candidate.getUTCMonth() !== month || candidate.getUTCDate() !== day) return undefined;
  if (!suppliedYear && candidate.getTime() < Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate())) {
    candidate = new Date(Date.UTC(year + 1, month, day, 12));
  }
  return candidate;
}

export function statedCadence(text: string): Cadence["type"] | undefined {
  const word = text.match(CADENCE_WORD)?.[1].toLowerCase();
  return word ? CADENCE_BY_WORD[word] : undefined;
}

export function statedAmountMinor(text: string): number | undefined {
  const match = text.match(MONEY_PATTERN);
  if (!match) return undefined;
  const amount = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return undefined;
  const minor = Math.round(amount * 100);
  return Number.isSafeInteger(minor) ? minor : undefined;
}

export function combineEmailText(input: EmailObligationFactInput): string {
  const subject = input.subject ?? "";
  const textBody = input.textBody ?? "";
  return `${subject}\n${textBody}`.trim();
}
