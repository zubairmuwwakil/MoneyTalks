-- Price provenance on holdings.
--
-- A price without a currency cannot be summed with another price. Until now every
-- holding's price was implicitly assumed to be in its account's currency, which
-- held only because equity prices were typed in by hand. Sourcing them from
-- MarketLens makes the assumption false the first time a TSX symbol lands in a
-- USD account, so the currency travels with the price and valuation refuses to
-- add figures it cannot prove are comparable.
ALTER TABLE "Holding" ADD COLUMN "priceCurrency" TEXT;
ALTER TABLE "Holding" ADD COLUMN "priceSource"   TEXT;
ALTER TABLE "Holding" ADD COLUMN "priceStatus"   TEXT;

-- Deliberately NOT backfilled to the account currency. Existing prices were
-- entered by hand with no currency recorded, so stamping one would be inventing
-- evidence — the same reasoning that made ingested currency nullable rather than
-- defaulting to CAD. Null reads as "unknown", the UI says so, and the next
-- refresh fills it in from the provider.

-- BYOK: a user's own upstream market-data credential, encrypted at rest here and
-- never stored in MarketLens.
CREATE TABLE "ProviderCredential" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "provider"     TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "label"        TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    "lastUsedAt"   TIMESTAMP(3),
    "lastStatus"   TEXT,

    CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderCredential_userId_provider_key" ON "ProviderCredential"("userId", "provider");
CREATE INDEX "ProviderCredential_userId_idx" ON "ProviderCredential"("userId");

ALTER TABLE "ProviderCredential" ADD CONSTRAINT "ProviderCredential_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
