-- Anonymous, opt-in PickMe merchant-MCC evidence. No user/account/device/contributor identifiers.
CREATE TABLE "CommunityMerchantMCCObservation" (
    "id" VARCHAR(255) NOT NULL,
    "merchantId" VARCHAR(120) NOT NULL,
    "placeId" VARCHAR(255),
    "latitude" DECIMAL(8,4),
    "longitude" DECIMAL(9,4),
    "channel" VARCHAR(16) NOT NULL,
    "network" VARCHAR(20),
    "mcc" INTEGER NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommunityMerchantMCCObservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommunityMerchantMCCObservation_merchantId_observedAt_idx"
ON "CommunityMerchantMCCObservation"("merchantId", "observedAt");

CREATE INDEX "CommunityMerchantMCCObservation_placeId_observedAt_idx"
ON "CommunityMerchantMCCObservation"("placeId", "observedAt");

CREATE INDEX "CommunityMerchantMCCObservation_location_idx"
ON "CommunityMerchantMCCObservation"("merchantId", "latitude", "longitude", "observedAt");
