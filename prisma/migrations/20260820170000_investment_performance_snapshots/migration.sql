-- Preserve the exact daily valuation inputs used to calculate a user's
-- investment performance. Market prices remain canonical in MarketLens; these
-- rows are an auditable record of personal quantities, cash, flows, and FX.
CREATE TYPE "InvestmentSnapshotStatus" AS ENUM ('COMPLETE', 'PARTIAL');

CREATE TABLE "InvestmentAccountSnapshot" (
    "id"                       TEXT NOT NULL,
    "accountId"                TEXT NOT NULL,
    "asOf"                     TIMESTAMP(3) NOT NULL,
    "currency"                 TEXT NOT NULL,
    "cashMinor"                INTEGER NOT NULL,
    "holdingsMinor"            INTEGER NOT NULL,
    "totalMinor"               INTEGER NOT NULL,
    "netExternalFlowMinor"     INTEGER NOT NULL DEFAULT 0,
    "displayCurrency"          TEXT NOT NULL DEFAULT 'CAD',
    "displayTotalMinor"        INTEGER NOT NULL,
    "displayExternalFlowMinor" INTEGER NOT NULL DEFAULT 0,
    "fxRateToDisplay"          DECIMAL(65,30),
    "fxAsOf"                   TIMESTAMP(3),
    "status"                   "InvestmentSnapshotStatus" NOT NULL,
    "holdingCount"             INTEGER NOT NULL,
    "pricedHoldingCount"       INTEGER NOT NULL,
    "earliestPriceAsOf"        TIMESTAMP(3),
    "latestPriceAsOf"          TIMESTAMP(3),
    "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestmentAccountSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvestmentPositionSnapshot" (
    "id"                      TEXT NOT NULL,
    "accountSnapshotId"       TEXT NOT NULL,
    "holdingId"               TEXT,
    "symbol"                  TEXT NOT NULL,
    "name"                    TEXT NOT NULL,
    "quantity"                DECIMAL(65,30) NOT NULL,
    "priceMinor"              INTEGER NOT NULL,
    "priceCurrency"           TEXT,
    "priceAsOf"               TIMESTAMP(3) NOT NULL,
    "priceSource"             TEXT,
    "priceStatus"             TEXT,
    "marketValueMinor"        INTEGER NOT NULL,
    "displayMarketValueMinor" INTEGER NOT NULL,
    "valuationComplete"       BOOLEAN NOT NULL,

    CONSTRAINT "InvestmentPositionSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvestmentAccountSnapshot_accountId_asOf_key"
    ON "InvestmentAccountSnapshot"("accountId", "asOf");
CREATE INDEX "InvestmentAccountSnapshot_accountId_asOf_idx"
    ON "InvestmentAccountSnapshot"("accountId", "asOf");
CREATE UNIQUE INDEX "InvestmentPositionSnapshot_accountSnapshotId_symbol_key"
    ON "InvestmentPositionSnapshot"("accountSnapshotId", "symbol");
CREATE INDEX "InvestmentPositionSnapshot_accountSnapshotId_idx"
    ON "InvestmentPositionSnapshot"("accountSnapshotId");

ALTER TABLE "InvestmentAccountSnapshot"
    ADD CONSTRAINT "InvestmentAccountSnapshot_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- There is intentionally no foreign key from holdingId to Holding. A current
-- holding can be removed after a sale without erasing historical performance.
ALTER TABLE "InvestmentPositionSnapshot"
    ADD CONSTRAINT "InvestmentPositionSnapshot_accountSnapshotId_fkey"
    FOREIGN KEY ("accountSnapshotId") REFERENCES "InvestmentAccountSnapshot"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
