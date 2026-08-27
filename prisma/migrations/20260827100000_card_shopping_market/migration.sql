-- The catalogue's market is where a product is sold, not an owner's residency.
-- Keep the browsing choice explicit and default existing owners to the current
-- Canadian catalogue experience rather than inferring it from their accounts.
ALTER TABLE "Profile" ADD COLUMN "cardShoppingMarket" TEXT NOT NULL DEFAULT 'CA';
