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
  matchesSender?(fromEmail: string): boolean;
  extractPayee(evidence: MessageEvidence & { fromEmail?: string | null }): string | undefined;
};

const GENERIC_PAYEES = new Set([
  "app store",
  "apple",
  "apple inc",
  "apple services",
  "google",
  "google inc",
  "google llc",
  "google payments",
  "google play",
  "google play store",
  "itunes",
  "itunes store",
  "merchant",
  "microsoft",
  "microsoft billing",
  "microsoft corp",
  "microsoft corporation",
  "microsoft inc",
  "microsoft store",
  "paypal",
  "paypal inc",
  "seller",
  "shopify",
  "shopify email",
  "store",
  "stripe",
  "stripe inc",
  "stripe payments",
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
    .replace(/\s*\([^\n()]*#[^\n()]*\)\s*$/u, "")
    .replace(/\s*\[[^\n[\]]*#[^\n[\]]*\]\s*$/u, "")
    .replace(/\s+(?:transaction|receipt|invoice|order)\s+(?:id|number|no\.?|#).*$/iu, "")
    .replace(/\s+transaction date\b.*$/iu, "")
    .replace(/\s+(?:via|through)\s+(?:stripe|paypal|shopify|apple|google(?:\s+play)?|microsoft)\b.*$/iu, "")
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

const STRIPE_SENDER_PATTERN = /receipts\+acct_[a-z0-9]+@stripe\.com/i;

const STRIPE_PAYEE_PATTERNS = [
  /\b(?:your )?receipt from\s+([^\n]{2,100})/iu,
  /\b(?:your )?invoice from\s+([^\n]{2,100})/iu,
  /\b(?:receipt|invoice) (?:for|#\s*[a-z0-9-_]+) from\s+([^\n]{2,100})/iu,
  /\b(?:you were|you've been|you have been) charged (?:[^\n]{1,40}? )?by\s+([^\n]{2,100})/iu,
  /\b(?:you paid|payment(?: of [^\n]{1,40}?)? to)\s+([^\n]{2,100})/iu,
  /\b(?:billed|charged) by\s+([^\n]{2,100})/iu,
  /\b(?:thanks for (?:your )?(?:purchase|order) from)\s+([^\n]{2,100})/iu,
  /^(?:merchant|payee|seller|billed by)\s*:?[ \t]+([^\n]{2,100})/imu,
] as const;

function extractStripePayee({ fromEmail, subject, textBody }: MessageEvidence & { fromEmail?: string | null }): string | undefined {
  const fromSubject = firstPatternMatch([subject ?? ""], STRIPE_PAYEE_PATTERNS);
  if (fromSubject) return fromSubject;
  const fromBody = firstPatternMatch([textBody ?? ""], STRIPE_PAYEE_PATTERNS);
  if (fromBody) return fromBody;
  return displayNameFromAddress(fromEmail);
}

const APPLE_SENDER_PATTERN = /no_reply@email\.apple\.com/i;

const APPLE_PAYEE_PATTERNS = [
  /\byour subscription to\s+([^\n]{2,100}?)(?:\s+(?:will renew|has renewed|was renewed|renewed|is confirmed|renews|\$|\())/iu,
  /\byou(?:'ve| have)? subscribed to\s+([^\n]{2,100}?)(?:\s+(?:on|for|\$|\())/iu,
  /\b(?:seller|developer|publisher|provider|provided by)\s*:\s*([^\n]{2,100})/iu,
  /\b(?:item|subscription|app|product)\s*:\s*([^\n]{2,100})/iu,
  /\bApp Store\s*\n\s*([^\n]{2,100})/iu,
  /^([^\n]{2,100})\s*\n\s*(?:Renews|Subscription renewal|Report a Problem)\b/imu,
  /\b(?:receipt|invoice) for (?:your subscription to )?([^\n]{2,100}?)(?:\s+from Apple|\s*\n|$)/iu,
] as const;

function extractApplePayee({ subject, textBody }: MessageEvidence): string | undefined {
  return firstPatternMatch([textBody ?? "", subject ?? ""], APPLE_PAYEE_PATTERNS);
}

const GOOGLE_PLAY_SENDER_PATTERN = /(?:googleplay-noreply|payments-noreply)@google\.com/i;

const GOOGLE_PLAY_PAYEE_PATTERNS = [
  /\b(?:sold by|seller|developer|provider|provided by|merchant)\s*:\s*([^\n]{2,100})/iu,
  /\b(?:item|subscription|service|product|order from)\s*:\s*([^\n]{2,100})/iu,
  /\byour subscription to\s+([^\n]{2,100}?)(?:\s+(?:will renew|has renewed|was renewed|renewed|is confirmed|renews|\$|\())/iu,
  /\byou(?:'ve| have)? subscribed to\s+([^\n]{2,100}?)(?:\s+(?:on|for|\$|\())/iu,
  /\bthanks for (?:subscribing to|purchasing|your order with)\s+([^\n]{2,100}?)(?:\s+(?:on|for|\$|\.|\n))/iu,
  /\bItem\s+(?:Price|Cost)\s*\n\s*([^\n]{2,100})/iu,
  /\b(?:receipt|invoice) for\s+([^\n]{2,100}?)(?:\s+from Google Play|\s+from Google Payments|\s*\n|$)/iu,
] as const;

function extractGooglePlayPayee({ subject, textBody }: MessageEvidence): string | undefined {
  return firstPatternMatch([textBody ?? "", subject ?? ""], GOOGLE_PLAY_PAYEE_PATTERNS);
}

const MICROSOFT_BILLING_SENDER_PATTERN = /msbill@microsoft\.com/i;

const MICROSOFT_PAYEE_PATTERNS = [
  /\b(?:publisher|seller|sold by|merchant)\s*:\s*([^\n]{2,100})/iu,
  /\b(?:product|service|description|item|subscription)\s*:\s*([^\n]{2,100})/iu,
  /\byour subscription to\s+([^\n]{2,100}?)\s+(?:has renewed|was renewed|will renew|renewed|is confirmed|renews|\$|\()/iu,
  /\b(?:you were|you've been|you have been) billed for\s+([^\n]{2,100})/iu,
  /\bthanks for (?:subscribing to|purchasing|your order with)\s+([^\n]{2,100}?)(?:\s+(?:on|for|\$|\.|\n))/iu,
  /\b(?:Description|Product name)\s+(?:Price|Amount)\s*\n\s*([^\n]{2,100})/iu,
  /\b(?:receipt|invoice) for\s+([^\n]{2,100}?)(?:\s+from Microsoft|\s*\n|$)/iu,
] as const;

function extractMicrosoftPayee({ subject, textBody }: MessageEvidence): string | undefined {
  return firstPatternMatch([textBody ?? "", subject ?? ""], MICROSOFT_PAYEE_PATTERNS);
}

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
  {
    domain: "stripe.com",
    name: "Stripe",
    matchesSender: (fromEmail) => STRIPE_SENDER_PATTERN.test(fromEmail),
    extractPayee: extractStripePayee,
  },
  {
    domain: "apple.com",
    name: "Apple",
    matchesSender: (fromEmail) => APPLE_SENDER_PATTERN.test(fromEmail),
    extractPayee: extractApplePayee,
  },
  {
    domain: "google.com",
    name: "Google Play",
    matchesSender: (fromEmail) => GOOGLE_PLAY_SENDER_PATTERN.test(fromEmail),
    extractPayee: extractGooglePlayPayee,
  },
  {
    domain: "microsoft.com",
    name: "Microsoft",
    matchesSender: (fromEmail) => MICROSOFT_BILLING_SENDER_PATTERN.test(fromEmail),
    extractPayee: extractMicrosoftPayee,
  },
] as const;

function findConduitForSender(fromEmail: string): Conduit | undefined {
  const registrableDomain = normalizeMerchantFromSender(fromEmail);
  return CONDUITS.find((c) => {
    if (c.matchesSender) return c.matchesSender(fromEmail);
    return c.domain === registrableDomain;
  });
}

export function conduitForSender(fromEmail?: string | null): { domain: string; name: string } | undefined {
  if (!fromEmail) return undefined;
  const senderDomain = domainFromEmail(fromEmail);
  if (!senderDomain) return undefined;
  const registrableDomain = normalizeMerchantFromSender(fromEmail);

  const conduit = CONDUITS.find((c) => {
    if (c.matchesSender) return c.matchesSender(fromEmail);
    return c.domain === registrableDomain;
  });
  if (conduit) return { domain: conduit.domain, name: conduit.name };

  if (fromEmail.startsWith("operator@")) {
    const byDomain = CONDUITS.find(({ domain }) => domain === registrableDomain || domain === senderDomain);
    if (byDomain) return { domain: byDomain.domain, name: byDomain.name };
  }

  return undefined;
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
  const conduit = fromEmail ? findConduitForSender(fromEmail) : undefined;

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
