/**
 * Which currency is this receipt denominated in, and how do we know?
 *
 * ## Why this is not the extractor's job
 *
 * `extractTotalFromText` refuses to read a currency out of a bare "$", and it
 * is right to: the same glyph means CAD at Simons and USD at Anthropic, and a
 * line-level extractor sees only the line. That refusal left
 * `Purchase.currency` null on 56 of 60 real receipts — the amounts were read,
 * the unit was not, and a USD figure treated as CAD misstates money by about
 * a third without ever raising an error.
 *
 * The fix is not to make the extractor guess. It is to look at evidence the
 * extractor cannot see: receipts routinely say "All amounts in USD" in a
 * footer three blocks below the total. This resolver reads the WHOLE message,
 * so a bare "$" on the total line stays ambiguous while the footer resolves it.
 *
 * ## Why a ladder with provenance
 *
 * Same shape and same reasons as `resolveCategory` in
 * src/lib/domain/merchants/resolveCategory.ts: every tier returns one type
 * carrying where the answer came from, `shouldAutoApply` gates the weak ones,
 * and the stored `Purchase.currencySource` lets a later reader tell a read
 * fact from an inference. A new tier slots in as one more block without
 * touching a call site.
 *
 * ## Why two codes mean none
 *
 * A converted receipt quotes both ("Subtotal USD 90.00 / Charged CAD 124.11").
 * Taking the first, or the last, or the one nearest the total is a coin flip
 * wearing a reading's clothes. Ambiguity resolves to null — the same
 * discipline that removed the fabricated +30 day renewal dates (8e04b84).
 * `formatCurrencyCodeAmount` already renders null as "(currency unknown)", so
 * the UI stays honest about it.
 *
 * Deliberately absent: a profile-default fallback. Stamping CAD on an
 * unresolved receipt would close the null count and silently corrupt the
 * number, which is strictly worse than the gap it hides.
 *
 * Pure and synchronous. Every rule here is a unit test.
 */

export type CurrencySource =
  /** The owner corrected this purchase themselves. Nothing outranks it. */
  | "userOverride"
  /** The message states an unambiguous code — "CA$", or "All amounts in USD". */
  | "explicitCode"
  /** JSON-LD `priceCurrency`. Machine-readable, but rare in real receipts. */
  | "structuredMarkup"
  /** A Wallet capture linked to the same purchase carried an explicit code. */
  | "walletObservation"
  /** The owner confirmed this merchant's billing currency for their account. */
  | "ownerConfirmedForMerchant"
  | "none";

export type CurrencyConfidence = "certain" | "high" | "none";

export interface CurrencyResolution {
  /** An ISO-4217-shaped code, or null when nothing could be resolved. */
  currency: string | null;
  confidence: CurrencyConfidence;
  source: CurrencySource;
  /** One sentence a human can audit, not just log. */
  rationale: string;
}

export interface CurrencyObservation {
  /** A currency the owner set on this purchase. An instruction, not evidence. */
  ownerCurrency?: string | null;
  /** The decoded receipt body — the whole message, footer included. */
  messageText?: string | null;
  /** JSON-LD `priceCurrency`, when the sender shipped markup. */
  markupCurrency?: string | null;
  /** A currency this owner previously confirmed for this canonical merchant. */
  ownerConfirmedMerchantCurrency?: string | null;
}

/**
 * The same token set `MONEY` recognizes in gmailPurchaseParser, so the two
 * never disagree about what counts as a stated currency.
 */
const CODE_TOKENS: ReadonlyArray<{ pattern: RegExp; code: string }> = [
  // "CA$"/"Can$" must be tried as their own tokens: `\bCAD\b` never matches them.
  { pattern: /\bCan\$/gi, code: "CAD" },
  { pattern: /\bCA\$/gi, code: "CAD" },
  // Word boundaries keep "USD" out of the middle of a tracking number and
  // "CAD" out of "CADENCE" — a substring hit is a coincidence, not a claim.
  { pattern: /\bUSD\b/g, code: "USD" },
  { pattern: /\bCAD\b/g, code: "CAD" },
  { pattern: /\bEUR\b/g, code: "EUR" },
  { pattern: /\bGBP\b/g, code: "GBP" },
];

/** Only a code shaped like ISO 4217 is a code. "$" is a symbol, not an answer. */
function asCurrencyCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

/**
 * Every distinct currency the message states outright. Returns more than one
 * only when the receipt genuinely quotes more than one — which is the caller's
 * signal to resolve nothing.
 */
function statedCodes(text: string): string[] {
  const found = new Set<string>();
  for (const { pattern, code } of CODE_TOKENS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) found.add(code);
  }
  return [...found];
}

/** Only these tiers may write a currency without asking the owner first. */
export function shouldAutoApply(resolution: CurrencyResolution): boolean {
  return resolution.confidence === "certain" || resolution.confidence === "high";
}

/**
 * Runs the ladder. Order is the design: each tier is strictly better evidence
 * than the one below it, so the first hit wins.
 */
export function resolveCurrency(observation: CurrencyObservation): CurrencyResolution {
  const unresolved: CurrencyResolution = {
    currency: null,
    confidence: "none",
    source: "none",
    rationale: "This receipt states no currency, so the amount's unit is unknown.",
  };

  // 1. The owner's own correction. Not evidence to weigh — an instruction.
  const owner = asCurrencyCode(observation.ownerCurrency);
  if (owner) {
    return {
      currency: owner,
      confidence: "certain",
      source: "userOverride",
      rationale: `You set this purchase's currency to ${owner}.`,
    };
  }

  // 2. A code the message states in words. Beats markup because a sender who
  //    writes "All amounts in USD" is telling the reader the billing unit,
  //    while markup is frequently copy-pasted boilerplate.
  const codes = observation.messageText ? statedCodes(observation.messageText) : [];
  if (codes.length === 1) {
    return {
      currency: codes[0],
      confidence: "high",
      source: "explicitCode",
      rationale: `The receipt states ${codes[0]} outright.`,
    };
  }
  if (codes.length > 1) {
    return {
      ...unresolved,
      rationale: `The receipt names more than one currency (${codes.sort().join(", ")}), so no currency can be read from it.`,
    };
  }

  // 3. JSON-LD. Machine-readable and unambiguous when present — it fired on
  //    zero of the 60 messages in the 2026-08-29 corpus, so it earns its place
  //    by costing nothing rather than by carrying the load.
  const markup = asCurrencyCode(observation.markupCurrency);
  if (markup) {
    return {
      currency: markup,
      confidence: "high",
      source: "structuredMarkup",
      rationale: `The receipt's structured markup declares ${markup}.`,
    };
  }

  // 4. The owner told us this merchant's billing currency before. That is useful
  //    for a bare "$", but a fact about this message always outranks it.
  const merchantConfirmation = asCurrencyCode(observation.ownerConfirmedMerchantCurrency);
  if (merchantConfirmation) {
    return {
      currency: merchantConfirmation,
      confidence: "high",
      source: "ownerConfirmedForMerchant",
      rationale: `You previously confirmed ${merchantConfirmation} for this merchant.`,
    };
  }

  // 5. Nothing. An honest null the UI renders as "(currency unknown)", rather
  //    than a default that would misstate the amount by a third in silence.
  return unresolved;
}

/**
 * Combine a receipt's own reading with the other observations attached to the
 * same purchase.
 *
 * `resolveCurrency` reads one message. A `Purchase` outlives any single
 * message: an owner may have corrected it, and a linked Wallet capture may
 * carry an explicit code the receipt never stated. Reprocessing runs this
 * every time, which is exactly why the owner tier has to be here — without
 * it, a correction survived only until the next scan restated the unit.
 */
export function reconcileCurrency(inputs: {
  /** `Purchase.currency`, but ONLY when `currencySource` is "userOverride". */
  ownerCurrency?: string | null;
  /** What the receipt itself resolved to, source and all. */
  receipt: { currency: string | null; source: CurrencySource };
  /** `WalletEvent.currencyRaw` from a capture linked to this purchase. */
  walletCurrency?: string | null;
}): { currency: string | null; source: CurrencySource } {
  const owner = asCurrencyCode(inputs.ownerCurrency);
  if (owner) return { currency: owner, source: "userOverride" };

  const receipt = asCurrencyCode(inputs.receipt.currency);
  // A receipt's own reading is direct evidence. The merchant-level answer is
  // deliberately held until after a linked Wallet observation below.
  if (receipt && inputs.receipt.source !== "ownerConfirmedForMerchant") {
    return { currency: receipt, source: inputs.receipt.source };
  }

  const wallet = asCurrencyCode(inputs.walletCurrency);
  if (wallet) return { currency: wallet, source: "walletObservation" };

  if (receipt && inputs.receipt.source === "ownerConfirmedForMerchant") {
    return { currency: receipt, source: "ownerConfirmedForMerchant" };
  }

  return { currency: null, source: "none" };
}
