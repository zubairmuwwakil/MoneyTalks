import { z } from "zod";
import merchantPackRaw from "../../../../contracts/merchant-pack.json";
import { foldMerchantText } from "./normalizeMerchant";

/**
 * The vendored merchant pack (contracts/merchant-pack.json), parsed once and
 * indexed for lookup.
 *
 * PickMe owns these facts — they are generated from
 * `CanadianMerchantPreIndex.swift` and vendored here by
 * scripts/sync-contracts.sh, the same path card-catalogue.json takes. Nothing
 * in this repo authors a merchant category: a wrong row is fixed upstream in
 * the Swift table, not patched here, for the same reason a card rate is.
 *
 * It carries its own `packVersion` rather than riding card-contracts@N,
 * because merchant facts move on a different cadence from card rate facts.
 */

const merchantSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  category: z.string(),
  matchKeys: z.array(z.string()).min(1),
  emailDomains: z.array(z.string()).optional(),
  mcc: z.number().int().optional(),
  merchantBrand: z.string().optional(),
  acceptedNetworks: z.array(z.string()),
  notes: z.string().optional(),
});

const merchantPackSchema = z.object({
  packVersion: z.string().regex(/^\d+\.\d+$/),
  _provenance: z.unknown().optional(),
  merchants: z.array(merchantSchema).min(1),
});

export type PackMerchant = z.infer<typeof merchantSchema>;
export type MerchantPack = z.infer<typeof merchantPackSchema>;

/**
 * The MAJOR this build understands. A pack whose MAJOR moved has a shape this
 * code has not been taught, so it refuses rather than misreading it — the
 * same posture as SeedLoader's catalogue version gate.
 */
const SUPPORTED_PACK_MAJOR = 1;

function parsePack(data: unknown): MerchantPack {
  const pack = merchantPackSchema.parse(data);
  const major = Number(pack.packVersion.split(".")[0]);
  if (major !== SUPPORTED_PACK_MAJOR) {
    throw new Error(
      `contracts/merchant-pack.json is packVersion ${pack.packVersion}; this build supports major ${SUPPORTED_PACK_MAJOR}`,
    );
  }
  return pack;
}

export const merchantPack: MerchantPack = parsePack(merchantPackRaw);

/**
 * Match keys across every merchant, longest first.
 *
 * The order is the disambiguation rule and it is the whole reason this is a
 * sorted list rather than a hash lookup: "walmart supercentre" and "walmart"
 * are both keys, they are different merchants with different categories
 * (grocery vs. general merchandise), and the specific one has to win.
 */
const MATCH_INDEX: ReadonlyArray<{ key: string; merchant: PackMerchant }> = merchantPack.merchants
  .flatMap((merchant) => merchant.matchKeys.map((key) => ({ key, merchant })))
  .sort((a, b) => b.key.length - a.key.length || a.key.localeCompare(b.key));

const EMAIL_DOMAIN_INDEX: ReadonlyMap<string, PackMerchant> = new Map(
  merchantPack.merchants.flatMap((merchant) =>
    (merchant.emailDomains ?? []).map((domain) => [domain.toLowerCase(), merchant] as const),
  ),
);

const BY_ID: ReadonlyMap<string, PackMerchant> = new Map(merchantPack.merchants.map((m) => [m.id, m]));

/**
 * Whole-word containment, not `String.includes`.
 *
 * `includes` is what makes a keyword matcher produce confident nonsense:
 * "esso" is inside "espresso", "iga" is inside "cigarette". Requiring a word
 * boundary on both sides is the difference between a lookup and a guess.
 */
function containsWholeWord(haystack: string, needle: string): boolean {
  if (haystack === needle) return true;
  const index = haystack.indexOf(needle);
  if (index === -1) return false;
  for (let at = index; at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const beforeOk = at === 0 || haystack[at - 1] === " ";
    const afterOk = at + needle.length === haystack.length || haystack[at + needle.length] === " ";
    if (beforeOk && afterOk) return true;
  }
  return false;
}

/** Longest matching key wins; null when nothing in the pack claims this key. */
export function findPackMerchantByBrandKey(brandKey: string): PackMerchant | null {
  if (!brandKey) return null;
  for (const entry of MATCH_INDEX) {
    if (containsWholeWord(brandKey, entry.key)) return entry.merchant;
  }
  return null;
}

/**
 * Resolves a sender address or bare domain to a merchant.
 *
 * Subdomains resolve to their parent (`email.marriott.com` -> `marriott.com`),
 * because issuers and merchants send from a different subdomain per campaign
 * and pinning every one of them is not a maintainable list.
 */
export function findPackMerchantByEmail(address: string | null | undefined): PackMerchant | null {
  if (!address) return null;
  const domain = address.trim().toLowerCase().split("@").pop()?.replace(/^www\./, "");
  if (!domain) return null;

  const direct = EMAIL_DOMAIN_INDEX.get(domain);
  if (direct) return direct;

  const labels = domain.split(".");
  for (let start = 1; start < labels.length - 1; start += 1) {
    const parent = EMAIL_DOMAIN_INDEX.get(labels.slice(start).join("."));
    if (parent) return parent;
  }
  return null;
}

export function findPackMerchantById(id: string): PackMerchant | null {
  return BY_ID.get(id) ?? null;
}

/**
 * Category -> the MCC the pack's own rows most often carry for it.
 *
 * This is the fallback for a purchase whose category is known but whose
 * merchant is not — a category the owner picked by hand, say. It is derived
 * from the pack rather than hand-written so it cannot go stale, and it exists
 * because of a documented sharp edge in `RuleMatcher.matches`: when a rule
 * carries `mccInclude` and the purchase's MCC is null, the category branch
 * falls through to `true`, so an UNKNOWN MCC matches every MCC-gated bonus
 * rule unconditionally. See src/lib/domain/bills/cardForBill.ts, which
 * defuses the same trap for bills.
 *
 * A representative MCC is an assumption, and every caller must disclose it as
 * one. It is never presented as observed.
 */
export const REPRESENTATIVE_MCC_BY_CATEGORY: ReadonlyMap<string, number> = (() => {
  const counts = new Map<string, Map<number, number>>();
  for (const merchant of merchantPack.merchants) {
    if (merchant.mcc === undefined) continue;
    const forCategory = counts.get(merchant.category) ?? new Map<number, number>();
    forCategory.set(merchant.mcc, (forCategory.get(merchant.mcc) ?? 0) + 1);
    counts.set(merchant.category, forCategory);
  }
  const modal = new Map<string, number>();
  for (const [category, mccCounts] of counts) {
    // Ties break on the lower MCC so the table is a pure function of the pack
    // and does not shuffle when two codes draw.
    const [best] = [...mccCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    modal.set(category, best[0]);
  }
  return modal;
})();

/**
 * MCC -> category, for the codes the pack is UNANIMOUS about.
 *
 * Unanimity, not a majority. MCC 5814 ("fast food") covers 14 dining rows and
 * 3 food-delivery rows here, so a modal vote would call every Uber Eats order
 * dining and silently misprice it against a card that separates the two. A
 * code that means two things in the pack means two things in the world, and
 * the merchant name — a strictly better signal — is left to decide instead.
 *
 * The table is therefore small on purpose. It is also, today, mostly
 * theoretical: no source in this repo supplies an observed MCC yet, so being
 * strict here costs nothing and cannot be wrong later.
 */
export const CATEGORY_BY_MCC: ReadonlyMap<number, string> = (() => {
  const seen = new Map<number, Set<string>>();
  for (const merchant of merchantPack.merchants) {
    if (merchant.mcc === undefined) continue;
    const categories = seen.get(merchant.mcc) ?? new Set<string>();
    categories.add(merchant.category);
    seen.set(merchant.mcc, categories);
  }
  const unanimous = new Map<number, string>();
  for (const [mcc, categories] of seen) {
    if (categories.size === 1) unanimous.set(mcc, [...categories][0]);
  }
  return unanimous;
})();

/** Normalizes a free-text merchant name the same way the pack's keys were built. */
export { foldMerchantText };
