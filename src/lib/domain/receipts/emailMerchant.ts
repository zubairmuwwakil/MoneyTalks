// Email senders arrive as bare domains ("americanexpress.com"). Wallet taps
// arrive as display names ("AMERICAN EXPRESS"). Both resolve through the same
// global MerchantAlias table so the two sources agree on a name — which is
// what lets findMatchingPurchase merge an email receipt with a card tap
// instead of recording the same purchase twice.

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

export async function resolveEmailMerchant(
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
