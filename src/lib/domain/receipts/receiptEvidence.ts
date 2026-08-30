// Gates between "an email was observed" and "a purchase happened".
//
// The scan used to assert a Purchase for every message it fetched, so a
// newsletter with no amount became a purchase with a null total and a
// "you might want to return this" suggestion. Both questions below must be
// answered affirmatively before anything is asserted downstream.

export type ParsedEvidence = {
  rawSource: "jsonld" | "pdf" | "text";
  totalCents?: number | null;
  orderId?: string | null;
  subject?: string | null;
  textBody?: string | null;
};

export type ReceiptClass = "BILL" | "SUBSCRIPTION" | "RETURN";

// A quoted renewal amount is useful evidence for an upcoming obligation, but
// it is not evidence that money moved. Keep this deliberately narrow: the
// completed-charge override prevents an ordinary receipt whose footer also
// discusses its next renewal from being demoted.
const PROSPECTIVE_RENEWAL_SUBJECT = /\b(auto-?renewal notice|renewal reminder|renews? soon|upcoming (?:auto-?)?renewal|upcoming charge)\b/i;
const PROSPECTIVE_CHARGE_BODY = /\b(?:will|we(?:'ll| will)|scheduled to|set to|try to|attempt to)\b[^.\n]{0,100}\b(?:charge|bill|renew|take payment|process payment)\b/i;
const COMPLETED_CHARGE = /\b(initial charge|total (?:paid|charged)|amount (?:paid|charged)|payment (?:received|processed|completed)|has been charged|was charged|order summary|thanks for (?:your )?(?:purchase|order))\b/i;

/** Does this message describe a charge that may happen later, not one that happened? */
export function hasProspectiveChargeEvidence(parsed: ParsedEvidence): boolean {
  if (parsed.rawSource === "jsonld") return false;
  const subject = parsed.subject ?? "";
  const body = parsed.textBody ?? "";
  const haystack = `${subject}\n${body}`;
  if (COMPLETED_CHARGE.test(haystack)) return false;
  return PROSPECTIVE_RENEWAL_SUBJECT.test(subject) || PROSPECTIVE_CHARGE_BODY.test(body);
}

/** Did the parser actually find something that proves money changed hands? */
export function hasPurchaseEvidence(parsed: ParsedEvidence): boolean {
  if (hasProspectiveChargeEvidence(parsed)) return false;
  // Structured commerce markup is self-declaring: the sender tagged it an Order.
  if (parsed.rawSource === "jsonld") return true;
  // A $0.00 "total" is a promo or a free-shipping notice, never a purchase.
  if (typeof parsed.totalCents === "number" && parsed.totalCents > 0) return true;
  if (typeof parsed.orderId === "string" && parsed.orderId.trim().length > 0) return true;
  return false;
}

// A paid subscription always states what happens to money; a newsletter
// opt-in ("Confirm Your Subscription") never does.
const SUBSCRIPTION_WORD = /\b(subscription|membership|plan)\b/i;
const SUBSCRIPTION_MONEY = /\b(renew(s|ed|al|ing)?|auto-?renew|recurring|will be charged|has been charged|billed|billing|trial (ends|expires)|next payment)\b/i;

const ORDER_SIGNAL = /\b(order (confirmation|number|total|#)|your order|order #|has shipped|out for delivery|has been delivered|tracking (number|#)|shipment|your receipt|receipt (from|for)|thanks for your (purchase|order))\b/i;

const BILL_SIGNAL = /\b(invoice|statement (is )?(ready|available)|your statement|amount due|payment due|balance due|bill is ready)\b/i;

/**
 * Classify a receipt-ish email, or return null when there is no purchase
 * signal at all. Null is the honest answer for marketing mail — the previous
 * implementation fell through to RETURN, which is what turned 95 newsletters
 * into return suggestions.
 */
export function classifyReceiptEmail(
  subject: string | null | undefined,
  body: string | null | undefined
): ReceiptClass | null {
  const haystack = `${subject ?? ""}\n${body ?? ""}`;

  if (SUBSCRIPTION_WORD.test(haystack) && SUBSCRIPTION_MONEY.test(haystack)) return "SUBSCRIPTION";
  // Goods win over bills: an e-commerce "invoice for your order" is a
  // returnable purchase, not a utility bill.
  if (ORDER_SIGNAL.test(haystack)) return "RETURN";
  if (BILL_SIGNAL.test(haystack)) return "BILL";

  return null;
}
