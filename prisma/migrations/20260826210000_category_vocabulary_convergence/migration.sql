-- Category vocabulary convergence.
--
-- `src/lib/categories.ts` used to define its own category ids while
-- `RuleMatcher.matches` compared `PurchaseContext.category` to the card
-- catalogue's tokens with raw string equality. Five ids differed only in
-- spelling, so a purchase the owner had categorized scored at base earn and
-- accrued nothing against its cap:
--
--   groceries -> grocery            gas       -> gasStation
--   bills     -> householdUtilities drugstore -> drugStore
--   hotel     -> lodging
--
-- Four more ids had no engine meaning at all (shopping, home_improvement,
-- online_foreign, warehouse); they collapse onto the catalogue's own tokens.
--
-- Rows are matched case-insensitively because `/settings/merchants` accepted
-- free text. Values already in the catalogue's vocabulary are untouched:
-- every UPDATE below is keyed on a legacy spelling, so re-running is a no-op.
--
-- `categorySource` records WHICH TIER decided a category (see
-- src/lib/domain/merchants/resolveCategory.ts). It is nullable and null means
-- "decided before provenance was tracked" — never "unknown tier", which is
-- why it is not defaulted.

ALTER TABLE "Purchase" ADD COLUMN "categorySource" TEXT;

-- Everything migrated below was an owner decision made through the picker,
-- so it is stamped as such rather than left null.
UPDATE "Purchase" SET "category" = 'grocery',            "categorySource" = COALESCE("categorySource", 'merchantAlias') WHERE lower("category") IN ('groceries');
UPDATE "Purchase" SET "category" = 'gasStation',         "categorySource" = COALESCE("categorySource", 'merchantAlias') WHERE lower("category") IN ('gas', 'gas_station', 'gasstation');
UPDATE "Purchase" SET "category" = 'householdUtilities', "categorySource" = COALESCE("categorySource", 'merchantAlias') WHERE lower("category") IN ('bills', 'utilities', 'utility', 'recurringbill', 'recurringbills', 'recurring_bill', 'recurring_bills', 'householdutilities');
UPDATE "Purchase" SET "category" = 'drugStore',          "categorySource" = COALESCE("categorySource", 'merchantAlias') WHERE lower("category") IN ('drugstore', 'pharmacy');
UPDATE "Purchase" SET "category" = 'lodging',            "categorySource" = COALESCE("categorySource", 'merchantAlias') WHERE lower("category") IN ('hotel', 'hotels');
UPDATE "Purchase" SET "category" = 'travel',             "categorySource" = COALESCE("categorySource", 'merchantAlias') WHERE lower("category") IN ('flight', 'flights');
UPDATE "Purchase" SET "category" = 'digitalMedia',       "categorySource" = COALESCE("categorySource", 'merchantAlias') WHERE lower("category") IN ('digital_media', 'digitalmedia');
UPDATE "Purchase" SET "category" = 'foodDelivery',       "categorySource" = COALESCE("categorySource", 'merchantAlias') WHERE lower("category") IN ('food_delivery', 'fooddelivery', 'delivery');
UPDATE "Purchase" SET "category" = 'carRental',          "categorySource" = COALESCE("categorySource", 'merchantAlias') WHERE lower("category") IN ('car_rental', 'carrental');
UPDATE "Purchase" SET "category" = 'wholesaleClub',      "categorySource" = COALESCE("categorySource", 'merchantAlias') WHERE lower("category") IN ('warehouse', 'wholesale', 'wholesaleclub');
UPDATE "Purchase" SET "category" = 'ctFamily',           "categorySource" = COALESCE("categorySource", 'merchantAlias') WHERE lower("category") IN ('ct_family', 'ctfamily');
UPDATE "Purchase" SET "category" = 'marriottDirect',     "categorySource" = COALESCE("categorySource", 'merchantAlias') WHERE lower("category") IN ('marriott', 'marriottdirect');
UPDATE "Purchase" SET "category" = 'evCharging',         "categorySource" = COALESCE("categorySource", 'merchantAlias') WHERE lower("category") IN ('ev', 'ev_charging');
UPDATE "Purchase" SET "category" = 'other',              "categorySource" = COALESCE("categorySource", 'merchantAlias') WHERE lower("category") IN ('shopping', 'retail', 'general_retail', 'home_improvement', 'online_foreign', 'everythingelse', 'everything_else', 'unknown');

-- The same convergence for the global alias table, which is where the picker
-- actually writes and where every future purchase reads its category from.
UPDATE "MerchantAlias" SET "category" = 'grocery'            WHERE lower("category") IN ('groceries');
UPDATE "MerchantAlias" SET "category" = 'gasStation'         WHERE lower("category") IN ('gas', 'gas_station', 'gasstation');
UPDATE "MerchantAlias" SET "category" = 'householdUtilities' WHERE lower("category") IN ('bills', 'utilities', 'utility', 'recurringbill', 'recurringbills', 'recurring_bill', 'recurring_bills', 'householdutilities');
UPDATE "MerchantAlias" SET "category" = 'drugStore'          WHERE lower("category") IN ('drugstore', 'pharmacy');
UPDATE "MerchantAlias" SET "category" = 'lodging'            WHERE lower("category") IN ('hotel', 'hotels');
UPDATE "MerchantAlias" SET "category" = 'travel'             WHERE lower("category") IN ('flight', 'flights');
UPDATE "MerchantAlias" SET "category" = 'digitalMedia'       WHERE lower("category") IN ('digital_media', 'digitalmedia');
UPDATE "MerchantAlias" SET "category" = 'foodDelivery'       WHERE lower("category") IN ('food_delivery', 'fooddelivery', 'delivery');
UPDATE "MerchantAlias" SET "category" = 'carRental'          WHERE lower("category") IN ('car_rental', 'carrental');
UPDATE "MerchantAlias" SET "category" = 'wholesaleClub'      WHERE lower("category") IN ('warehouse', 'wholesale', 'wholesaleclub');
UPDATE "MerchantAlias" SET "category" = 'ctFamily'           WHERE lower("category") IN ('ct_family', 'ctfamily');
UPDATE "MerchantAlias" SET "category" = 'marriottDirect'     WHERE lower("category") IN ('marriott', 'marriottdirect');
UPDATE "MerchantAlias" SET "category" = 'evCharging'         WHERE lower("category") IN ('ev', 'ev_charging');
UPDATE "MerchantAlias" SET "category" = 'other'              WHERE lower("category") IN ('shopping', 'retail', 'general_retail', 'home_improvement', 'online_foreign', 'everythingelse', 'everything_else', 'unknown');

-- A cap accrual computed under the old vocabulary was computed against a
-- category the engine could not match, so the row it produced is not a record
-- of a rule that fired — it is a record of one that did not. The normalization
-- sweep recomputes them; nothing here rewrites a ledger it cannot re-derive.

-- Finding uncategorized purchases is the "needs review" queue's only query.
CREATE INDEX "Purchase_userId_category_purchasedAt_idx" ON "Purchase"("userId", "category", "purchasedAt");
