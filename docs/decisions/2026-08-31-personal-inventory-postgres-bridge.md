# Personal inventory moves behind a Postgres service boundary

**Date:** 2026-08-31  
**Status:** Accepted

## Decision

Personal inventory will move from Notion-only state to a Postgres-backed domain with an append-only event ledger and a narrow machine API.

The migration is deliberately **mirror-first**:

1. Notion remains authoritative while Postgres mirrors canonical Shopping Needs, Personal Care Products, and Inventory Events.
2. Notion webhooks provide near-real-time updates; a scheduled full reconciliation repairs missed or out-of-order delivery.
3. API/AI inventory mutations commit current product state, an immutable inventory event, and an outbox entry in one Postgres transaction.
4. The outbox projects those mutations back to Notion without making Notion availability part of the write transaction.
5. Only after reconciliation is proven clean will authority flip to Postgres. That cutover is a separate owner decision.

## Boundary

This code lives under `src/lib/personal-data/inventory` inside In Unity only because the connected tooling cannot create a new repository. It is a bounded deployment module, not a financial domain.

It must not:
- depend on bills, cards, purchases, subscriptions, or market-data models;
- expose Prisma implementation details to agents;
- store real Notion IDs, inventory records, or secrets in the public repository.

It may later be extracted mechanically to a standalone `personal-data-service`.

## Identity

`Need ID` and `Product ID` are canonical machine identities. Notion page IDs are projection mappings only.

Never use a mutable page title as identity when a stable ID exists.

## Writes

Agent and external writes go through the inventory API, not through arbitrary Notion property edits.

Each write requires an idempotency key. A successful write persists:
- the new product state,
- a typed inventory event,
- outbox work for Notion projection,

inside one database transaction.

## Notion synchronization

Webhook processing:
- verifies `X-Notion-Signature` against the exact raw request body;
- requires a separate high-entropy URL key even for the unsigned bootstrap request;
- stores the Notion verification token encrypted at rest;
- deduplicates webhook event IDs;
- retrieves the latest page state instead of trusting event ordering.

A 15-minute reconciliation remains the safety net because webhook delivery is at-least-once and may be out of order.

## Event history

Events are append-only business history. Corrections use `ADJUSTMENT`; they do not rewrite earlier purchase/open/finish events.

This history is the prerequisite for later consumption-rate and reorder-date forecasting.

## Security and privacy

The repository is public. All integration credentials and Notion resource IDs are runtime configuration.

The machine API is protected by a separate high-entropy bearer key. The Notion webhook verification token is encrypted with the existing secret-encryption keyring.

## Rejected alternatives

- **Keep Notion as the permanent backend:** simple now, but weak for transactional writes, idempotency, audit history, and agent-safe APIs.
- **Direct dual writes from every caller:** creates partial-failure states and couples every agent to Notion.
- **Put this in `agent-orchestrator`:** wrong ownership; that repository orchestrates coding agents rather than personal application data.
- **Big-bang Postgres cutover:** unnecessary risk before mirror reconciliation has been observed in production.
