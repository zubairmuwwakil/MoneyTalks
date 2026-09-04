-- Anonymous, opt-in PickMe gift-card inventory evidence. No user/account/device identifiers.
CREATE TABLE "CommunityGiftCardInventoryObservation" (
    "id" VARCHAR(255) NOT NULL,
    "merchantKey" VARCHAR(160) NOT NULL,
    "placeId" VARCHAR(255),
    "latitude" DECIMAL(8,4),
    "longitude" DECIMAL(9,4),
    "instrumentKey" VARCHAR(200) NOT NULL,
    "availability" VARCHAR(16) NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommunityGiftCardInventoryObservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "community_gc_place_idx"
ON "CommunityGiftCardInventoryObservation"("instrumentKey", "placeId", "observedAt");

CREATE INDEX "community_gc_coord_idx"
ON "CommunityGiftCardInventoryObservation"("instrumentKey", "merchantKey", "latitude", "longitude", "observedAt");

CREATE INDEX "community_gc_received_idx"
ON "CommunityGiftCardInventoryObservation"("receivedAt");
