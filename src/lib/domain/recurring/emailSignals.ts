import { classifyReceiptEmail } from "@/lib/domain/receipts/receiptEvidence";
import type { Cadence } from "@/engine/recurrence";
import type { ObligationFact } from "./types";

/**
 * The persisted EmailTransaction fields plus parsed text when it is available.
 * `textBody` is deliberately optional: current rows do not retain it, while
 * the later ingestion boundary can supply it without making this module impure.
 */
export interface EmailTransactionSignalInput {
  subject?: string | null;
  textBody?: string | null;
  purchasedAt?: Date | null;
  createdAt?: Date | null;
}

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

const CADENCE_BY_WORD: Readonly<Record<string, Cadence["type"]>> = Object.freeze({
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

const CADENCE_WORD = /\b(weekly|biweekly|fortnightly|monthly|quarterly|semi-?annual|yearly|annually)\b/i;
const OBLIGATION_CONTEXT = /\b(subscription|membership|plan|renew(?:al|s|ing)?|billing|bill(?:ed|ing)?|payment|invoice|statement|trial)\b/i;
const RECURRING_LANGUAGE = /\b(auto-?renew(?:al|s|ing)?|recurring|renews? automatically)\b/i;
const CANCELLATION_LANGUAGE = /\b(cancel(?:led|ed)|cancellation (?:is )?(?:confirmed|complete)|subscription (?:has |will )?end(?:ed|s)?)\b/i;
const TRIAL_STARTED_LANGUAGE = /\btrial (?:has )?(?:started|begun|begins|starts)\b/i;
const TRIAL_ENDED_LANGUAGE = /\btrial (?:has )?(?:ended|expires?|is ending)\b/i;
const PRICE_CHANGE_LANGUAGE = /\b(?:price|rate) (?:has |will )?(?:increase|increased|change|changed)|\b(?:new|updated) (?:price|rate)\b/i;
const NEXT_BILLING_LANGUAGE = /\b(?:next (?:billing date|bill|payment|charge|renewal)|will be (?:billed|charged)|next (?:payment|charge) (?:is )?due)\b/i;
const DATE_PATTERN = /\b(\d{4})-(\d{2})-(\d{2})\b|\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i;
const MONEY_PATTERN = /(?:CAD|USD|EUR|GBP|CA\$|Can\$|\$)\s*([0-9][0-9,]*(?:\.\d{2})?)/i;

function validDate(date: Date | null | undefined): date is Date {
  return date instanceof Date && Number.isFinite(date.getTime());
}

function firstDate(text: string, relativeTo: Date): Date | undefined {
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

function statedCadence(text: string): Cadence["type"] | undefined {
  const word = text.match(CADENCE_WORD)?.[1].toLowerCase();
  return word ? CADENCE_BY_WORD[word] : undefined;
}

function statedAmountMinor(text: string): number | undefined {
  const match = text.match(MONEY_PATTERN);
  if (!match) return undefined;
  const amount = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return undefined;
  const minor = Math.round(amount * 100);
  return Number.isSafeInteger(minor) ? minor : undefined;
}

/**
 * Extract only explicit, operational subscription facts. This is intentionally
 * narrower than a keyword classifier: a marketing message is not evidence.
 */
export function extractEmailSignals(inputs: readonly EmailTransactionSignalInput[]): ObligationFact[] {
  const facts: ObligationFact[] = [];

  for (const input of inputs) {
    const occurredAt = validDate(input.purchasedAt) ? input.purchasedAt : input.createdAt;
    if (!validDate(occurredAt)) continue;

    const subject = input.subject ?? "";
    const textBody = input.textBody ?? "";
    const text = `${subject}\n${textBody}`.trim();
    if (!text || !OBLIGATION_CONTEXT.test(text)) continue;

    // The receipt classifier is the first gate for ordinary renewal mail. The
    // remaining explicit state transitions are operational facts in their own
    // right and must also work when no payment amount is quoted.
    const receiptClass = classifyReceiptEmail(subject, textBody);
    const cadence = statedCadence(text);
    const hasCadenceOperation = cadence !== undefined && /\b(renew(?:al|s|ing)?|bill(?:ed|ing)?|charg(?:e|ed|ing)|payment)\b/i.test(text);
    const isExplicitOperationalFact = (
      RECURRING_LANGUAGE.test(text)
      || CANCELLATION_LANGUAGE.test(text)
      || TRIAL_STARTED_LANGUAGE.test(text)
      || TRIAL_ENDED_LANGUAGE.test(text)
      || PRICE_CHANGE_LANGUAGE.test(text)
      || NEXT_BILLING_LANGUAGE.test(text)
      || hasCadenceOperation
    );
    if (receiptClass === null && !isExplicitOperationalFact) continue;

    if (cadence && hasCadenceOperation) facts.push({ type: "EXPLICIT_CADENCE", occurredAt, cadence });
    if (RECURRING_LANGUAGE.test(text)) facts.push({ type: "EXPLICIT_RECURRING", occurredAt });

    if (CANCELLATION_LANGUAGE.test(text)) {
      facts.push({ type: "CANCELLATION", occurredAt, effectiveAt: firstDate(text, occurredAt) });
    }
    if (TRIAL_STARTED_LANGUAGE.test(text)) {
      facts.push({ type: "TRIAL_STARTED", occurredAt, effectiveAt: firstDate(text, occurredAt) });
    }
    if (TRIAL_ENDED_LANGUAGE.test(text)) {
      facts.push({ type: "TRIAL_ENDED", occurredAt, effectiveAt: firstDate(text, occurredAt) });
    }
    if (PRICE_CHANGE_LANGUAGE.test(text)) {
      facts.push({
        type: "PRICE_CHANGE",
        occurredAt,
        effectiveAt: firstDate(text, occurredAt),
        amountMinor: statedAmountMinor(text),
      });
    }
    if (NEXT_BILLING_LANGUAGE.test(text)) {
      const billingAt = firstDate(text, occurredAt);
      if (billingAt) facts.push({ type: "NEXT_BILLING_DATE", occurredAt, billingAt });
    }
  }

  return facts;
}
