// Email senders arrive as bare domains ("americanexpress.com"). Wallet taps
// arrive as display names ("AMERICAN EXPRESS"). Both resolve through the same
// global MerchantAlias table so the two sources agree on a name — which is
// what lets findMatchingPurchase merge an email receipt with a card tap
// instead of recording the same purchase twice.

import {
  domainFromEmail,
  normalizeMerchantFromSender,
} from "@/lib/domain/merchants/emailDomain";
import {
  findPackMerchantByBrandKey,
  findPackMerchantByEmail,
  foldMerchantText,
} from "@/lib/domain/merchants/merchantPack";

type AliasRow = { rawString: string; normalizedName: string };

type AliasDb = {
  merchantAlias: {
    findUnique(args: { where: { rawString: string } }): Promise<AliasRow | null>;
    create(args: { data: { rawString: string; normalizedName: string } }): Promise<AliasRow>;
  };
};

export type EmailMerchantResolution = {
  merchant: string;
  identity: "RESOLVED" | "UNRESOLVED_CONDUIT";
  source: "SENDER" | "CONDUIT_CONTENT" | "CONDUIT_UNRESOLVED";
};

type MessageEvidence = {
  subject?: string | null;
  textBody?: string | null;
};

type Conduit = {
  domain: string;
  name: string;
  extractPayee(evidence: MessageEvidence & { fromEmail?: string | null }): string | undefined;
};

const GENERIC_PAYEES = new Set([
  "merchant",
  "paypal",
  "paypal inc",
  "seller",
  "shopify",
  "shopify email",
  "store",
  "the merchant",
  "the seller",
]);

function cleanPayee(value: string | undefined): string | undefined {
  // PayPal truncates some names in both subject and body. Treat that as an
  // honest gap: removing the ellipsis would turn a visibly incomplete label
  // into a confident canonical identity.
  if (!value || /(?:\.\.\.|…)/u.test(value)) return undefined;
  const candidate = value
    ?.replace(/\([^\n()]*@[^\n()]*\)\s*$/u, "")
    .replace(/\s+(?:transaction|receipt|invoice|order)\s+(?:id|number|no\.?|#).*$/iu, "")
    .replace(/\s+transaction date\b.*$/iu, "")
    .replace(/[\s.,:;!|\-–—]+$/u, "")
    .replace(/^[\s"']+|[\s"']+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!candidate || candidate.length < 2 || candidate.length > 100) return undefined;
  if (GENERIC_PAYEES.has(foldMerchantText(candidate))) return undefined;
  if (/^(?:(?:US|CA|C)?\$|(?:USD|CAD|EUR|GBP)\b|\d)/iu.test(candidate)) return undefined;
  if (/^(?:you|your|we|payment|purchase|receipt|invoice|order)\b/iu.test(candidate)) return undefined;
  if (/^(?:https?:\/\/|www\.)/iu.test(candidate)) return undefined;
  return candidate;
}

function firstPatternMatch(sources: readonly string[], patterns: readonly RegExp[]): string | undefined {
  for (const source of sources) {
    for (const pattern of patterns) {
      const candidate = cleanPayee(source.match(pattern)?.[1]);
      if (candidate) return candidate;
    }
  }
  return undefined;
}

function displayNameFromAddress(fromEmail?: string | null): string | undefined {
  const match = fromEmail?.match(/^\s*(?:"([^"]+)"|([^<]+?))\s*<[^>]+>\s*$/u);
  return cleanPayee(match?.[1] ?? match?.[2]);
}

const PAYPAL_PAYEE_PATTERNS = [
  /\b(?:you (?:sent|made)|we sent) (?:a )?payment(?: of [^\n]{1,40}?)? to\s+([^\n]{2,100})/iu,
  /\b(?:your )?receipt for (?:your )?(?:paypal )?payment to\s+([^\n]{2,100})/iu,
  /\byour (?:paypal )?payment to\s+([^\n]{2,100})/iu,
  /\byou (?:have )?authorized a payment(?: of [^\n]{1,40}?)? to\s+([^\n]{2,100})/iu,
  /\byour refund(?: of [^\n]{1,40}?)? from\s+(.+?)\s+is on the way\b/iu,
  /\byou originally paid\s+(.+?)\s+(?:(?:US|CA|C)?\$|(?:USD|CAD|EUR|GBP)\b)/iu,
  /\byou paid\s+(?:(?:US|CA|C)?\$[0-9,.]+(?:\s+(?:USD|CAD|EUR|GBP))?|(?:USD|CAD|EUR|GBP)\s+\$?[0-9,.]+)\s+to\s+([^\n]{2,100})/iu,
  /^(?:merchant|seller)\s*:?[ \t]+([^\n]{2,100})/imu,
] as const;

function extractPayPalPayee(evidence: MessageEvidence): string | undefined {
  const subject = evidence.subject ?? "";
  // PayPal's subject is the cleanest evidence when it is complete. Its HTML
  // tables repeat labels and values in ways that can turn a merchant called
  // "AICA Merchant Services" into the nonsensical payee "Services".
  if (!subject.includes("...")) {
    const fromSubject = firstPatternMatch([subject], PAYPAL_PAYEE_PATTERNS);
    if (fromSubject) return fromSubject;
  }
  return firstPatternMatch([evidence.textBody ?? "", subject], PAYPAL_PAYEE_PATTERNS);
}

const SHOPIFY_PAYEE_PATTERNS = [
  /\b(?:your )?(?:receipt|order confirmation) from\s+([^\n]{2,100})/iu,
  /\bthanks for (?:your order|shopping) (?:at|with)\s+([^\n]{2,100})/iu,
  /\b(?:merchant|seller|store)\s*:\s*([^\n]{2,100})/iu,
] as const;

// These are ingestion facts owned by the hub. They deliberately do not live
// in contracts/merchant-pack.json: that contract is PickMe's retail/category
// decision input, while this list describes how receipt transport works.
const CONDUITS: readonly Conduit[] = [
  {
    domain: "paypal.com",
    name: "PayPal",
    extractPayee: extractPayPalPayee,
  },
  {
    domain: "shopifyemail.com",
    name: "Shopify Email",
    extractPayee: ({ fromEmail, subject, textBody }) =>
      firstPatternMatch([subject ?? "", textBody ?? ""], SHOPIFY_PAYEE_PATTERNS)
      ?? displayNameFromAddress(fromEmail),
  },
] as const;

export function conduitForSender(fromEmail?: string | null): { domain: string; name: string } | undefined {
  const senderDomain = domainFromEmail(fromEmail);
  if (!senderDomain) return undefined;
  const registrableDomain = normalizeMerchantFromSender(fromEmail);
  const conduit = CONDUITS.find(({ domain }) => domain === registrableDomain);
  return conduit ? { domain: conduit.domain, name: conduit.name } : undefined;
}

async function resolveRawMerchant(
  db: AliasDb,
  rawMerchant: string,
  fromEmail?: string,
): Promise<string> {
  const rawString = rawMerchant.trim();
  if (!rawString) return rawMerchant;

  // Canonical contract facts outrank the shared alias table. emailDomains is
  // exact evidence; matchKeys also lets a country-specific sender such as
  // netflix.co.uk resolve when the pack only lists netflix.com.
  const packMerchant =
    findPackMerchantByEmail(fromEmail ?? rawString) ??
    findPackMerchantByBrandKey(foldMerchantText(rawString));
  if (packMerchant) return packMerchant.displayName;

  try {
    const existing = await db.merchantAlias.findUnique({ where: { rawString } });
    if (existing) return existing.normalizedName;

    try {
      // Seed with the raw string and no category: the name stays honest until
      // someone curates it at /settings/merchants, and the alias exists to be
      // curated at all.
      const created = await db.merchantAlias.create({ data: { rawString, normalizedName: rawString } });
      return created.normalizedName;
    } catch {
      // Concurrent scan won the unique race — use whatever it wrote.
      const theirs = await db.merchantAlias.findUnique({ where: { rawString } });
      return theirs?.normalizedName ?? rawString;
    }
  } catch {
    // Never let merchant naming block ingestion.
    return rawString;
  }
}

export async function resolveEmailMerchantIdentity(
  db: AliasDb,
  rawMerchant: string,
  fromEmail?: string,
  evidence: MessageEvidence = {},
): Promise<EmailMerchantResolution> {
  const registrableDomain = fromEmail ? normalizeMerchantFromSender(fromEmail) : undefined;
  const conduit = CONDUITS.find(({ domain }) => domain === registrableDomain);

  if (conduit) {
    const payee = conduit.extractPayee({ ...evidence, fromEmail });
    if (!payee) {
      return {
        merchant: `Unresolved payee via ${conduit.name}`,
        identity: "UNRESOLVED_CONDUIT",
        source: "CONDUIT_UNRESOLVED",
      };
    }
    return {
      merchant: await resolveRawMerchant(db, payee),
      identity: "RESOLVED",
      source: "CONDUIT_CONTENT",
    };
  }

  return {
    merchant: await resolveRawMerchant(db, rawMerchant, fromEmail),
    identity: "RESOLVED",
    source: "SENDER",
  };
}

/** Backwards-compatible name-only resolver for callers that do not need provenance. */
export async function resolveEmailMerchant(
  db: AliasDb,
  rawMerchant: string,
  fromEmail?: string,
  evidence: MessageEvidence = {},
): Promise<string> {
  return (await resolveEmailMerchantIdentity(db, rawMerchant, fromEmail, evidence)).merchant;
}
