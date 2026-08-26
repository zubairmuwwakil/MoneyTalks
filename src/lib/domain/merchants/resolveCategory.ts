import { normalizeCategoryId } from "@/lib/categories";
import { normalizeMerchant, type NormalizedMerchant } from "./normalizeMerchant";
import {
  CATEGORY_BY_MCC,
  REPRESENTATIVE_MCC_BY_CATEGORY,
  findPackMerchantByBrandKey,
  findPackMerchantByEmail,
  type PackMerchant,
} from "./merchantPack";

/**
 * The cold-start resolver: what category is this purchase, and how sure are we?
 *
 * ## Why a ladder and not a keyword engine
 *
 * Neither Apple Wallet nor a Gmail receipt exposes a network MCC, so a new
 * merchant arrives as a bare string. The obvious fix — scan it for keywords —
 * is the one that produces confident nonsense: "CAFE" matches
 * "CAFE SUPPLY WHOLESALE", "ESSO" matches "ESPRESSO". What works instead is
 * normalizing the string to a brand key and then looking it up EXACTLY, with
 * fuzzy evidence demoted to a suggestion rather than an answer.
 *
 * So every tier below returns the same shape and carries where it came from.
 * That single decision is what buys three things at once: the UI can show
 * "you said" differently from "we guessed", the ladder can be re-run when the
 * pack ships new rows, and a future tier (a model, a geocoder) slots in as one
 * more `case` without touching a single call site.
 *
 * ## Why confidence is not a number
 *
 * A score invites a threshold nobody can defend. These four levels each mean
 * something a caller can act on, and the gate is `shouldAutoApply` — mirroring
 * PickMe's `ConfidenceSource.isVerified` (Store/Sources/CardCopilotStore/Models.swift),
 * which draws the same line for the same reason.
 *
 * ## The MCC obligation
 *
 * A resolution carries an MCC because `RuleMatcher.matches` treats a NULL MCC
 * as matching every `mccInclude` rule unconditionally — an unknown MCC is a
 * confidently wrong answer, not a conservative one. When the MCC is not the
 * merchant's own known code it is a representative one, `mccObserved` is
 * false, and the caller must say so. Same discipline as
 * src/lib/domain/bills/cardForBill.ts.
 *
 * Pure and synchronous: the caller does the database reads and hands the
 * results in. Every rule here is a unit test.
 */

export type CategorySource =
  /** The owner pinned this merchant themselves. Nothing outranks it. */
  | "userOverride"
  /** A curated `MerchantAlias.category` — an owner decision, shared globally. */
  | "merchantAlias"
  /** The network told us. Never available from Wallet capture today. */
  | "observedMcc"
  /** An e-receipt's sender domain. `noreply@ubereats.com` is unambiguous. */
  | "emailDomain"
  /** The vendored merchant pack matched the brand key. */
  | "brandPack"
  /** An MCC we did not observe, read through the pack's own code table. */
  | "mccTable"
  /** The payment processor implies the trade (Toast is restaurants-only). */
  | "processorPrior"
  | "none";

export type CategoryConfidence = "certain" | "high" | "medium" | "low" | "none";

export interface CategoryResolution {
  /** A catalogue category token, or null when nothing could be resolved. */
  category: string | null;
  /** Display name to prefer for the merchant, when a tier identified one. */
  displayName: string | null;
  /** The pack merchant id behind the answer, for provenance and re-runs. */
  merchantId: string | null;
  mcc: number | null;
  /** False means the MCC is representative and MUST be disclosed as assumed. */
  mccObserved: boolean;
  confidence: CategoryConfidence;
  source: CategorySource;
  /** Other categories worth offering the owner when this is only a suggestion. */
  alternatives: string[];
  /** One sentence a human can audit. Rendered in the UI, not just logged. */
  rationale: string;
  /** The normalization this ran on, so a caller can store or explain it. */
  normalized: NormalizedMerchant;
}

export interface MerchantObservation {
  /** The raw descriptor: `WalletEvent.merchantRaw` or an email's merchant. */
  merchantRaw?: string | null;
  /** `EmailTransaction.fromEmail`, when the observation came from a receipt. */
  emailFromAddress?: string | null;
  /** A genuinely observed MCC. Not available from Wallet capture today. */
  observedMcc?: number | null;
  /** `MerchantAlias.category`, already read by the caller. */
  aliasCategory?: string | null;
  /** A per-user pin, when one exists. */
  userOverrideCategory?: string | null;
}

/**
 * Processors that only serve one trade. Toast sells restaurant point-of-sale
 * and nothing else, so its branding on a descriptor is real evidence about an
 * otherwise unknown merchant. Square is deliberately absent: it takes payments
 * for barbers, market stalls and dentists alike, and a prior that broad is a
 * guess wearing a prior's clothes.
 */
const PROCESSOR_PRIORS: Readonly<Record<string, string>> = Object.freeze({
  toast: "dining",
  doordash: "foodDelivery",
  skipthedishes: "foodDelivery",
});

/** Only these two tiers may write a category without asking the owner first. */
export function shouldAutoApply(resolution: CategoryResolution): boolean {
  return resolution.confidence === "certain" || resolution.confidence === "high";
}

/** A resolution worth showing as a one-tap suggestion rather than applying. */
export function isSuggestion(resolution: CategoryResolution): boolean {
  return (
    resolution.category !== null &&
    (resolution.confidence === "medium" || resolution.confidence === "low")
  );
}

function representativeMcc(category: string | null): number | null {
  if (!category) return null;
  return REPRESENTATIVE_MCC_BY_CATEGORY.get(category) ?? null;
}

function fromPack(
  merchant: PackMerchant,
  source: CategorySource,
  confidence: CategoryConfidence,
  rationale: string,
  normalized: NormalizedMerchant,
  observedMcc: number | null,
): CategoryResolution {
  return {
    category: merchant.category,
    displayName: merchant.displayName,
    merchantId: merchant.id,
    mcc: observedMcc ?? merchant.mcc ?? representativeMcc(merchant.category),
    mccObserved: observedMcc != null,
    confidence,
    source,
    alternatives: [],
    rationale,
    normalized,
  };
}

/**
 * Runs the ladder. Order is the design: each tier is strictly better evidence
 * than the one below it, so the first hit wins and no tier ever needs to know
 * about another.
 */
export function resolveCategory(observation: MerchantObservation): CategoryResolution {
  const normalized = normalizeMerchant(observation.merchantRaw);

  const unresolved: CategoryResolution = {
    category: null,
    displayName: null,
    merchantId: null,
    mcc: null,
    mccObserved: false,
    confidence: "none",
    source: "none",
    alternatives: [],
    rationale: "No tier recognized this merchant.",
    normalized,
  };

  // 1. The owner's own pin. Not evidence to weigh — an instruction.
  const override = normalizeCategoryId(observation.userOverrideCategory);
  if (override) {
    return {
      ...unresolved,
      category: override,
      mcc: representativeMcc(override),
      confidence: "certain",
      source: "userOverride",
      rationale: "You set this category for this merchant.",
    };
  }

  // 2. A curated alias. Someone decided this deliberately; the pack did not.
  const alias = normalizeCategoryId(observation.aliasCategory);
  if (alias) {
    return {
      ...unresolved,
      category: alias,
      mcc: observation.observedMcc ?? representativeMcc(alias),
      mccObserved: observation.observedMcc != null,
      confidence: "certain",
      source: "merchantAlias",
      rationale: "Saved from a previous purchase at this merchant.",
    };
  }

  // 3. An observed MCC beats every inference — the network said it. Resolved
  //    through the pack's own code table, so it stays as auditable as the
  //    rows it came from.
  if (observation.observedMcc != null) {
    const fromMcc = CATEGORY_BY_MCC.get(observation.observedMcc);
    if (fromMcc) {
      return {
        ...unresolved,
        category: fromMcc,
        mcc: observation.observedMcc,
        mccObserved: true,
        confidence: "high",
        source: "observedMcc",
        rationale: `The network coded this purchase as MCC ${observation.observedMcc}.`,
      };
    }
  }

  // 4. An e-receipt's sender domain. Exact, and impossible to confuse with a
  //    different merchant the way a descriptor substring can be.
  const byEmail = findPackMerchantByEmail(observation.emailFromAddress);
  if (byEmail) {
    return fromPack(
      byEmail,
      "emailDomain",
      "high",
      `The receipt came from ${byEmail.displayName}'s own email domain.`,
      normalized,
      observation.observedMcc ?? null,
    );
  }

  // 5. The pack, on an exact whole-word brand key.
  const byBrand = normalized.brandKey ? findPackMerchantByBrandKey(normalized.brandKey) : null;
  if (byBrand) {
    return fromPack(
      byBrand,
      "brandPack",
      "high",
      `"${normalized.brandKey}" is ${byBrand.displayName} in the merchant pack.`,
      normalized,
      observation.observedMcc ?? null,
    );
  }

  // 6. A single-trade processor. Real evidence, but about the TRADE rather
  //    than the merchant, so it is offered and never applied.
  const prior = normalized.processor ? PROCESSOR_PRIORS[normalized.processor] : undefined;
  if (prior) {
    return {
      ...unresolved,
      category: prior,
      mcc: representativeMcc(prior),
      confidence: "medium",
      source: "processorPrior",
      alternatives: prior === "dining" ? ["foodDelivery"] : ["dining"],
      rationale: `Paid through ${normalized.processor}, which only serves one trade — but the merchant itself is unrecognized.`,
    };
  }

  // 7. Nothing. An honest null, not a guess dressed as an answer: the owner
  //    is asked, and their answer becomes tier 2 for everyone.
  return unresolved;
}

/**
 * The engine inputs for a resolution, or nulls when it resolved nothing.
 * Callers building a `PurchaseContext` should use this rather than reading
 * `.category`/`.mcc` directly, so the MCC obligation travels with them.
 */
export function purchaseContextFields(resolution: CategoryResolution): {
  category: string;
  mcc: number | undefined;
  mccAssumed: boolean;
} {
  return {
    // `RuleMatcher` compares raw strings; "unknown" matches no category
    // clause, which is exactly the base-rate answer an unresolved merchant
    // deserves.
    category: resolution.category ?? "unknown",
    mcc: resolution.mcc ?? undefined,
    mccAssumed: resolution.mcc != null && !resolution.mccObserved,
  };
}
