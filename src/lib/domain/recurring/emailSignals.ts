import type { Cadence } from "@/engine/recurrence";
import {
  extractEmailObligationFacts,
} from "@/lib/domain/receipts/emailObligationFacts";
import {
  CADENCE_WORD,
  CANCELLATION_LANGUAGE,
  NEXT_BILLING_LANGUAGE,
  PRICE_CHANGE_LANGUAGE,
  RECURRING_LANGUAGE,
  TRIAL_ENDED_LANGUAGE,
  TRIAL_STARTED_LANGUAGE,
  validDate,
} from "@/lib/domain/receipts/factHelpers";
import type { ObligationFact } from "./types";

export {
  CADENCE_WORD,
  CANCELLATION_LANGUAGE,
  NEXT_BILLING_LANGUAGE,
  PRICE_CHANGE_LANGUAGE,
  RECURRING_LANGUAGE,
  TRIAL_ENDED_LANGUAGE,
  TRIAL_STARTED_LANGUAGE,
};

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

/**
 * Extract only explicit, operational subscription facts by delegating to the
 * pure per-fact extractors under receipts/.
 */
export function extractEmailSignals(inputs: readonly EmailTransactionSignalInput[]): ObligationFact[] {
  const facts: ObligationFact[] = [];

  for (const input of inputs) {
    const occurredAt = validDate(input.purchasedAt) ? input.purchasedAt : input.createdAt;
    if (!validDate(occurredAt)) continue;

    const extracted = extractEmailObligationFacts({
      subject: input.subject,
      textBody: input.textBody,
      occurredAt,
    });

    for (const fact of extracted) {
      switch (fact.type) {
        case "EXPLICIT_CADENCE":
          if (fact.cadence) {
            facts.push({
              type: fact.type,
              occurredAt: fact.occurredAt,
              cadence: fact.cadence as Cadence["type"],
            });
          }
          break;
        case "EXPLICIT_RECURRING":
          facts.push({ type: fact.type, occurredAt: fact.occurredAt });
          break;
        case "CANCELLATION":
        case "TRIAL_STARTED":
        case "TRIAL_ENDED":
          facts.push({
            type: fact.type,
            occurredAt: fact.occurredAt,
            effectiveAt: fact.effectiveAt,
          });
          break;
        case "PRICE_CHANGE":
          facts.push({
            type: fact.type,
            occurredAt: fact.occurredAt,
            effectiveAt: fact.effectiveAt,
            amountMinor: fact.amountMinor,
          });
          break;
        case "NEXT_BILLING_DATE":
          if (fact.billingAt) {
            facts.push({
              type: fact.type,
              occurredAt: fact.occurredAt,
              billingAt: fact.billingAt,
            });
          }
          break;
      }
    }
  }

  return facts;
}
