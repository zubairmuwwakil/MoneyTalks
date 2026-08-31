-- Personal inventory bridge: Postgres mirror, append-only events, Notion mappings,
-- webhook receipts and transactional outbox. Notion remains authoritative during
-- the initial mirror-first migration.

CREATE TYPE "PersonalInventoryEventType" AS ENUM (
  'PURCHASED', 'OPENED', 'FINISHED', 'ADJUSTMENT', 'RETURNED', 'DISCARDED'
);

CREATE TYPE "PersonalInventoryEventSource" AS ENUM (
  'NOTION', 'MANUAL', 'BUTTON', 'AI', 'API', 'IMPORT'
);

CREATE TYPE "PersonalNotionEntityType" AS ENUM (
  'NEED', 'PRODUCT', 'EVENT'
);

CREATE TYPE "PersonalInventoryOutboxTopic" AS ENUM (
  'SYNC_PRODUCT_TO_NOTION', 'CREATE_EVENT_IN_NOTION'
);

CREATE TYPE "PersonalInventoryOutboxStatus" AS ENUM (
  'PENDING', 'PROCESSING', 'SENT', 'FAILED'
);

CREATE TABLE "personal_inventory_needs" (
  "id" TEXT NOT NULL,
  "ownerKey" TEXT NOT NULL DEFAULT 'primary',
  "stableId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "aisle" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "backupTarget" INTEGER NOT NULL DEFAULT 1,
  "reorderPoint" INTEGER,
  "defaultRetailer" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personal_inventory_needs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "personal_inventory_products" (
  "id" TEXT NOT NULL,
  "ownerKey" TEXT NOT NULL DEFAULT 'primary',
  "stableId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "brand" TEXT,
  "careArea" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "backupUnits" INTEGER NOT NULL DEFAULT 0,
  "inUse" BOOLEAN NOT NULL DEFAULT false,
  "openedAt" TIMESTAMP(3),
  "repurchase" TEXT,
  "needsIdentification" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "needId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personal_inventory_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "personal_inventory_events" (
  "id" TEXT NOT NULL,
  "ownerKey" TEXT NOT NULL DEFAULT 'primary',
  "externalKey" TEXT NOT NULL,
  "type" "PersonalInventoryEventType" NOT NULL,
  "quantityDelta" INTEGER NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "source" "PersonalInventoryEventSource" NOT NULL DEFAULT 'API',
  "notes" TEXT,
  "productId" TEXT,
  "needId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "personal_inventory_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "personal_notion_entity_maps" (
  "id" TEXT NOT NULL,
  "ownerKey" TEXT NOT NULL DEFAULT 'primary',
  "entityType" "PersonalNotionEntityType" NOT NULL,
  "stableId" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "dataSourceId" TEXT NOT NULL,
  "lastEditedAt" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personal_notion_entity_maps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "personal_notion_webhook_receipts" (
  "id" TEXT NOT NULL,
  "ownerKey" TEXT NOT NULL DEFAULT 'primary',
  "eventType" TEXT NOT NULL,
  "entityId" TEXT,
  "entityType" TEXT,
  "attemptNumber" INTEGER NOT NULL DEFAULT 1,
  "notionTimestamp" TIMESTAMP(3),
  "payload" JSONB NOT NULL,
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personal_notion_webhook_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "personal_notion_subscriptions" (
  "ownerKey" TEXT NOT NULL,
  "verificationTokenEncrypted" TEXT NOT NULL,
  "workspaceId" TEXT,
  "integrationId" TEXT,
  "subscriptionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personal_notion_subscriptions_pkey" PRIMARY KEY ("ownerKey")
);

CREATE TABLE "personal_inventory_outbox" (
  "id" TEXT NOT NULL,
  "ownerKey" TEXT NOT NULL DEFAULT 'primary',
  "topic" "PersonalInventoryOutboxTopic" NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "PersonalInventoryOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personal_inventory_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "personal_inventory_needs_ownerKey_stableId_key"
  ON "personal_inventory_needs"("ownerKey", "stableId");
CREATE INDEX "personal_inventory_needs_ownerKey_active_idx"
  ON "personal_inventory_needs"("ownerKey", "active");

CREATE UNIQUE INDEX "personal_inventory_products_ownerKey_stableId_key"
  ON "personal_inventory_products"("ownerKey", "stableId");
CREATE INDEX "personal_inventory_products_ownerKey_active_idx"
  ON "personal_inventory_products"("ownerKey", "active");
CREATE INDEX "personal_inventory_products_needId_idx"
  ON "personal_inventory_products"("needId");

CREATE UNIQUE INDEX "personal_inventory_events_ownerKey_externalKey_key"
  ON "personal_inventory_events"("ownerKey", "externalKey");
CREATE INDEX "personal_inventory_events_ownerKey_occurredAt_idx"
  ON "personal_inventory_events"("ownerKey", "occurredAt");
CREATE INDEX "personal_inventory_events_productId_occurredAt_idx"
  ON "personal_inventory_events"("productId", "occurredAt");
CREATE INDEX "personal_inventory_events_needId_occurredAt_idx"
  ON "personal_inventory_events"("needId", "occurredAt");

CREATE UNIQUE INDEX "personal_notion_entity_maps_pageId_key"
  ON "personal_notion_entity_maps"("pageId");
CREATE UNIQUE INDEX "personal_notion_entity_maps_ownerKey_entityType_stableId_key"
  ON "personal_notion_entity_maps"("ownerKey", "entityType", "stableId");
CREATE INDEX "personal_notion_entity_maps_ownerKey_dataSourceId_idx"
  ON "personal_notion_entity_maps"("ownerKey", "dataSourceId");

CREATE INDEX "personal_notion_webhook_receipts_ownerKey_processedAt_idx"
  ON "personal_notion_webhook_receipts"("ownerKey", "processedAt");

CREATE UNIQUE INDEX "personal_inventory_outbox_dedupeKey_key"
  ON "personal_inventory_outbox"("dedupeKey");
CREATE INDEX "personal_inventory_outbox_ownerKey_status_availableAt_idx"
  ON "personal_inventory_outbox"("ownerKey", "status", "availableAt");

ALTER TABLE "personal_inventory_products"
  ADD CONSTRAINT "personal_inventory_products_needId_fkey"
  FOREIGN KEY ("needId") REFERENCES "personal_inventory_needs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "personal_inventory_events"
  ADD CONSTRAINT "personal_inventory_events_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "personal_inventory_products"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "personal_inventory_events"
  ADD CONSTRAINT "personal_inventory_events_needId_fkey"
  FOREIGN KEY ("needId") REFERENCES "personal_inventory_needs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
