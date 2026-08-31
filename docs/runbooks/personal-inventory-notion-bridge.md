# Personal inventory — Notion/Postgres bridge

## Runtime configuration

Set these on the deployed In Unity service. Never commit their real values.

- `PERSONAL_DATA_OWNER_KEY` — logical owner key; use `primary` for the current single-owner deployment.
- `PERSONAL_DATA_API_KEY` — high-entropy bearer key for the machine inventory API.
- `PERSONAL_DATA_NOTION_WEBHOOK_KEY` — separate high-entropy URL guard for Notion webhook delivery.
- `NOTION_API_KEY` — Notion integration secret with access to the three canonical data sources.
- `NOTION_PERSONAL_SHOPPING_NEEDS_DATA_SOURCE_ID`
- `NOTION_PERSONAL_PRODUCTS_DATA_SOURCE_ID`
- `NOTION_PERSONAL_INVENTORY_EVENTS_DATA_SOURCE_ID`
- `QSTASH_PERSONAL_INVENTORY_CRON` — optional; defaults to `*/15 * * * *`.

The existing `SECRET_ENC_ACTIVE_VERSION` and matching `SECRET_ENC_KEY_V*` are also required because the webhook verification token is encrypted at rest.

## Release

1. Deploy the database migration separately with `npm run db:migrate:deploy`.
2. Deploy the application.
3. Register a Notion webhook subscription whose endpoint is:
   `/api/integrations/notion/webhook?key=<PERSONAL_DATA_NOTION_WEBHOOK_KEY>`
4. After Notion sends the initial verification POST, retrieve the stored token with an authenticated `GET /api/integrations/notion/webhook` using `PERSONAL_DATA_API_KEY`, then paste that one-time token into Notion's verification dialog. The token is never logged.
5. Subscribe to page create/property-update/delete/undelete events for the integration.
6. Run `npm run qstash:schedules` so `/api/cron/personal-inventory` reconciles every 15 minutes.
7. Invoke the cron once manually with valid cron authentication.
8. Confirm Postgres mirrors all active needs/products before considering any source-of-truth cutover.

## Machine API

`GET /api/personal-data/inventory/needs`

Returns the Postgres read model, including derived urgency and buy quantity.

`POST /api/personal-data/inventory/events`

Example request:

```json
{
  "idempotencyKey": "agent-2026-08-31-example-open-001",
  "productStableId": "product.example.product",
  "type": "OPENED",
  "source": "AI"
}
```

Supported event types: `PURCHASED`, `OPENED`, `FINISHED`, `ADJUSTMENT`, `RETURNED`, `DISCARDED`.

Send `Authorization: Bearer <PERSONAL_DATA_API_KEY>` or `x-personal-data-api-key`.

## Operational semantics

During the mirror-first phase, Notion is still authoritative for direct human edits. Postgres-originated API events are transactionally persisted first and projected back through the outbox.

Do not declare Postgres authoritative until reconciliation has been observed clean and the owner explicitly approves cutover.
