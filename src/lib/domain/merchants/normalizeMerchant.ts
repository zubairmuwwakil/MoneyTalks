/**
 * Turns a payment descriptor into a brand key.
 *
 * Apple Wallet and e-receipts hand us the merchant string a processor
 * printed, never a network MCC. Those strings are not merchant names — they
 * are merchant names wrapped in processor branding, store numbers, city and
 * province, and terminal noise:
 *
 *   SQ *CAFE METRO             -> cafe metro      (processor: square)
 *   TST* THE KEG - YONGE       -> the keg yonge   (processor: toast)
 *   TIM HORTONS #4021 TORONTO ON -> tim hortons   (store 4021, Toronto ON)
 *   UBER   *EATS PENDING       -> uber eats       (processor: uber)
 *
 * Getting this layer right is what lets everything above it be exact-match
 * rather than fuzzy. A keyword engine over raw strings matches "CAFE" inside
 * "CAFE SUPPLY WHOLESALE"; a normalizer plus an exact brand-key lookup does
 * not. Fuzzy matching is a fallback for what this cannot resolve, never the
 * primitive.
 *
 * Pure and synchronous on purpose — no I/O, no database — so every rule here
 * is a unit test rather than a fixture.
 */

export interface NormalizedMerchant {
  /** The input, untouched. Provenance: every derived value can be re-checked against it. */
  raw: string;
  /**
   * Lowercase, diacritics folded, single-spaced, noise stripped, processor
   * branding removed. The key to display and dedupe on.
   */
  brandKey: string;
  /**
   * The same cleaning WITHOUT removing the processor prefix.
   *
   * Some brands are their own processor — `UBER *EATS`, `AMZN Mktp CA*...`,
   * `ROGERS *WIRELESS` — so stripping the prefix deletes the merchant and
   * leaves "eats". A lookup must try this key first and fall back to
   * `brandKey`, which is what rescues the opposite case (`DD *DOORDASH X`,
   * where the name only appears after the prefix).
   */
  fullKey: string;
  /** Payment processor whose branding wrapped the name, when one is recognizable. */
  processor: string | null;
  /** Store/terminal number, when the descriptor carried one. */
  storeNumber: string | null;
  /** Trailing "CITY PR", when the descriptor carried one. Upper-cased as printed. */
  locality: string | null;
}

/**
 * Processor prefixes, longest first so `AMZN MKTP` is tried before `AMZN`.
 * A processor is *not* a merchant: "SQ *" means a small business took a card
 * through Square, and says nothing about what it sells — which is exactly why
 * it has to come off before matching, and why it is kept as its own field
 * rather than thrown away.
 */
const PROCESSOR_PREFIXES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^amzn\s*mktp\s*(ca|us)?\s*\*?/i, "amazon"],
  [/^apple\.com\/bill\s*/i, "apple"],
  [/^(paypal|pp)\s*\*/i, "paypal"],
  [/^py\s*\*/i, "paypal"],
  [/^sq\s*\*/i, "square"],
  [/^sqc?\*/i, "square"],
  [/^tst\s*\*/i, "toast"],
  [/^clv?\s*\*/i, "clover"],
  [/^iz\s*\*/i, "izettle"],
  [/^zp\s*\*/i, "zettle"],
  [/^sumup\s*\*/i, "sumup"],
  [/^shopify\s*\*/i, "shopify"],
  [/^sp\s+(?=[a-z])/i, "shopify"],
  [/^dd\s*\*/i, "doordash"],
  [/^doordash\s*\*/i, "doordash"],
  [/^skipthedishes\s*\*/i, "skipthedishes"],
  [/^uber\s*\*/i, "uber"],
  [/^lyft\s*\*/i, "lyft"],
  [/^msft\s*\*/i, "microsoft"],
  [/^google\s*\*/i, "google"],
  [/^intuit\s*\*/i, "intuit"],
  [/^stripe\s*\*/i, "stripe"],
  [/^wpy\s*\*/i, "wepay"],
  [/^eig\s*\*/i, "eig"],
];

/**
 * Issuer/terminal words that describe the TRANSACTION, not the merchant.
 * Stripped as whole words anywhere in the string. "PENDING" is here because
 * Apple Wallet includes it while an authorization is unsettled, so the same
 * merchant would otherwise produce two different keys minutes apart.
 */
const TRANSACTION_NOISE = new Set([
  "pos", "auth", "authorization", "purchase", "debit", "credit", "interac",
  "visa", "mastercard", "mc", "amex", "pending", "payment", "pmt", "recurring",
  "transaction", "trans", "ref", "invoice", "inv", "online", "web", "wwww",
]);

const CANADIAN_PROVINCES = new Set([
  "ab", "bc", "mb", "nb", "nl", "ns", "nt", "nu", "on", "pe", "qc", "sk", "yt",
]);

/** Two-letter US states, for descriptors from cross-border spend. */
const US_STATES = new Set([
  "ak", "al", "ar", "az", "ca", "co", "ct", "dc", "de", "fl", "ga", "hi", "ia",
  "id", "il", "in", "ks", "ky", "la", "ma", "md", "me", "mi", "mn", "mo", "ms",
  "mt", "nc", "nd", "ne", "nh", "nj", "nm", "nv", "ny", "oh", "ok", "or", "pa",
  "ri", "sc", "sd", "tn", "tx", "ut", "va", "vt", "wa", "wi", "wv", "wy",
]);

/**
 * Lowercase, fold diacritics, collapse every run of non-alphanumerics to one
 * space. The single canonical form — the merchant pack's `matchKeys` are
 * generated through the same transform in PickMe, which is what lets a lookup
 * be an exact comparison instead of a similarity score.
 */
export function foldMerchantText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stripProcessor(value: string): { rest: string; processor: string | null } {
  const trimmed = value.trim();
  for (const [pattern, processor] of PROCESSOR_PREFIXES) {
    if (pattern.test(trimmed)) {
      return { rest: trimmed.replace(pattern, "").trim(), processor };
    }
  }
  // A bare `NAME*SOMETHING` with no recognized prefix: the part before the
  // asterisk is processor branding we can't name. Keep the merchant half
  // rather than letting the unknown half poison the key.
  const bareStar = trimmed.match(/^([A-Za-z0-9]{2,10})\s*\*\s*(.+)$/);
  if (bareStar) return { rest: bareStar[2].trim(), processor: bareStar[1].toLowerCase() };
  return { rest: trimmed, processor: null };
}

/**
 * Words that only ever START a place name, never end a merchant name. They
 * are the reason a second city word can be taken safely.
 */
const CITY_PREFIX_WORDS = new Set([
  "north", "south", "east", "west", "new", "old", "saint", "st", "ste", "port",
  "fort", "lac", "mont", "grande", "grand", "thunder", "niagara", "richmond",
  "salt", "san", "santa", "los", "las", "sault",
]);

/**
 * Trailing "CITY PR" — the province/state token is what identifies it.
 *
 * Exactly ONE city word is taken by default, and a second only when the word
 * before it is a known place-name opener ("north york", "new minas"). The
 * asymmetry is the whole design: a match key is compared as a whole-word
 * substring, so leaving an extra token behind still matches
 * ("loblaws north" still contains "loblaws"), while eating one token too many
 * destroys the name outright — a greedy two-word city turns
 * "T&T SUPERMARKET RICHMOND BC" into "t t", which matches nothing. Under-
 * stripping is recoverable; over-stripping is not.
 */
function stripLocality(tokens: string[]): { rest: string[]; locality: string | null } {
  if (tokens.length < 2) return { rest: tokens, locality: null };
  const last = tokens[tokens.length - 1];
  if (!CANADIAN_PROVINCES.has(last) && !US_STATES.has(last)) return { rest: tokens, locality: null };

  // Never consume the whole string: a two-token descriptor like "ESSO ON" is
  // a merchant in Ontario, not a city called Esso.
  const cityWords: string[] = [];
  let index = tokens.length - 2;
  if (index >= 1 && /^[a-z]+$/.test(tokens[index])) {
    cityWords.unshift(tokens[index]);
    index -= 1;
    if (index >= 1 && CITY_PREFIX_WORDS.has(tokens[index])) {
      cityWords.unshift(tokens[index]);
    }
  }
  if (cityWords.length === 0) {
    return { rest: tokens.slice(0, -1), locality: last.toUpperCase() };
  }
  return {
    rest: tokens.slice(0, tokens.length - 1 - cityWords.length),
    locality: [...cityWords, last].join(" ").toUpperCase(),
  };
}

/**
 * Digit-only tokens: a store number, a terminal id, or a reference. Kept as
 * `storeNumber` when it looks like a store (`#1234` or a short run), dropped
 * otherwise — a 12-digit reference is unique per transaction and would give
 * every visit to the same shop a different key.
 */
function stripNumbers(raw: string, tokens: string[]): { rest: string[]; storeNumber: string | null } {
  const hashed = raw.match(/#\s*(\d{1,6})/);
  const rest: string[] = [];
  let storeNumber = hashed ? hashed[1] : null;

  for (const token of tokens) {
    if (!/^\d+$/.test(token)) {
      rest.push(token);
      continue;
    }
    if (storeNumber === null && token.length <= 5) storeNumber = token;
    // Every digit run is dropped from the key either way.
  }
  return { rest, storeNumber };
}

/**
 * Normalizes one merchant descriptor.
 *
 * Order is deliberate: processor branding comes off the RAW string (it is
 * punctuation-bearing — `SQ *`), then the remainder is folded, then trailing
 * locality, then numbers, then transaction noise. Folding first would destroy
 * the asterisk the processor rules key on.
 */
/** Locality, numbers and transaction noise off one already-folded string. */
function cleanKey(sourceForHash: string, folded: string): {
  key: string;
  storeNumber: string | null;
  locality: string | null;
} {
  if (!folded) return { key: "", storeNumber: null, locality: null };

  const { rest: afterLocality, locality } = stripLocality(folded.split(" "));
  const { rest: afterNumbers, storeNumber } = stripNumbers(sourceForHash, afterLocality);
  const cleaned = afterNumbers.filter((token) => !TRANSACTION_NOISE.has(token));

  // If stripping noise emptied the key, the "noise" was the name — a merchant
  // genuinely called "Online" or "Payment". Keep the pre-noise form rather
  // than returning nothing.
  const kept = cleaned.length > 0 ? cleaned : afterNumbers;
  return { key: kept.join(" ").trim(), storeNumber, locality };
}

export function normalizeMerchant(rawInput: string | null | undefined): NormalizedMerchant {
  const raw = (rawInput ?? "").trim();
  if (!raw) {
    return { raw: "", brandKey: "", fullKey: "", processor: null, storeNumber: null, locality: null };
  }

  const { rest: afterProcessor, processor } = stripProcessor(raw);
  const stripped = cleanKey(afterProcessor, foldMerchantText(afterProcessor));
  const full = cleanKey(raw, foldMerchantText(raw));

  return {
    raw,
    brandKey: stripped.key,
    fullKey: full.key,
    processor,
    // Prefer what the un-stripped form saw: a store number can sit inside the
    // part a processor rule removed.
    storeNumber: full.storeNumber ?? stripped.storeNumber,
    locality: full.locality ?? stripped.locality,
  };
}
