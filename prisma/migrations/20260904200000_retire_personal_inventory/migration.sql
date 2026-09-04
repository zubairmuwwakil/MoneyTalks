-- Retire the superseded personal-inventory module.
--
-- LLM4LIFE's config/domains.yaml names `product_tracker` the canonical owner of
-- personal_care_inventory, backed by its own neon_product_tracker database; that
-- cutover completed 2026-09-03. This repo's copy was a duplicate with the opposite
-- authority model and was never functional here -- Clerk intercepted its API and
-- webhook routes, its QStash schedule was quota-blocked and never fired, and all
-- seven tables were verified empty (0 rows) before this migration was written.
--
-- Application code was removed first; this is the contract half of that
-- expand/contract pair and must only run against a deploy that no longer
-- references these models.

DROP TABLE IF EXISTS "personal_inventory_outbox";
DROP TABLE IF EXISTS "personal_notion_subscriptions";
DROP TABLE IF EXISTS "personal_notion_webhook_receipts";
DROP TABLE IF EXISTS "personal_notion_entity_maps";
-- events references products and needs; products references needs.
DROP TABLE IF EXISTS "personal_inventory_events";
DROP TABLE IF EXISTS "personal_inventory_products";
DROP TABLE IF EXISTS "personal_inventory_needs";

DROP TYPE IF EXISTS "PersonalInventoryOutboxStatus";
DROP TYPE IF EXISTS "PersonalInventoryOutboxTopic";
DROP TYPE IF EXISTS "PersonalNotionEntityType";
DROP TYPE IF EXISTS "PersonalInventoryEventSource";
DROP TYPE IF EXISTS "PersonalInventoryEventType";
