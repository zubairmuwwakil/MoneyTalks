# Community Merchant MCC Backend

**Date:** 2026-09-04  
**Status:** implemented production service; architecture remains replaceable  
**Owner:** MoneyTalks / In Unity backend  
**Client:** PickMe

## Purpose

PickMe needs better merchant-category-code evidence without linking bank or credit-card accounts and without paying for a proprietary merchant database. MoneyTalks owns the anonymous network service that lets opted-in PickMe clients contribute and consume narrowly scoped MCC evidence.

This service is an **evidence transport and aggregation layer**, not PickMe's recommendation engine. PickMe remains responsible for merchant identity, prior distributions, evidence weighting, confidence, issuer reward rules, and the final card decision.

## Ownership boundary

```text
PickMe
  merchant identity + local evidence
  -> anonymous MCC report/query
        |
        v
MoneyTalks / In Unity
  validate -> bound -> retain -> aggregate
        |
        v
PickMe
  externalLocationReport evidence
  -> MerchantMCCGraph
  -> card recommendation / Purchase Routes
```

Do not move card recommendation semantics into these routes. Do not make PickMe depend on this service to complete checkout: local seed and local learning must continue to work when the backend is unavailable.

## API contract

Current production endpoints:

- `POST /api/community/merchant-mcc` — submit one explicit MCC observation.
- `POST /api/community/merchant-mcc/query` — ask for corroborated aggregate signals around up to 25 candidate stores.
- `GET /api/community/merchant-mcc/query` — production health probe; verifies the deployed route can reach the migrated table without exposing row counts or merchant data.

Wire schema version is `1`. PickMe and MoneyTalks both pin this contract in tests. A breaking change requires a new schema version or a compatibility window; do not silently reinterpret version 1.

## What is allowed to upload

The PickMe client queues a community report only after the owner explicitly supplied a **literal four-digit MCC** during reconciliation. Reward/category inference is useful locally but is not eligible for shared exact-MCC evidence.

The current PickMe wire sends only:

- random observation UUID;
- canonical PickMe merchant id;
- coarse store coordinates rounded to 3 decimal places (~100 m bucket);
- channel (`inStore` today);
- optional payment network;
- literal MCC;
- observation time.

The backend schema also supports a place id as a future location scope. The current PickMe community MCC client intentionally uses the coarse coordinate bucket instead so normal Wallet-vs-MapKit GPS drift does not fragment one store and the shared service does not require a precise visit trace.

Never add card id/number, purchase amount, Wallet descriptor, reward amount, account id, email, Clerk identity, user id, device id, IP-derived identity, or raw headers to the community observation model or telemetry.

## Consent and failure model

Community MCC sharing is off by default in PickMe. Local learning remains enabled regardless of this setting.

When sharing is disabled, PickMe clears its community MCC cache and pending upload queue. Community network failures are opportunistic failures: they must not make merchant discovery or checkout fail, and a still-fresh local cache may remain usable.

Upload retries are idempotent because observation UUID is the database primary key. A duplicate is a successful outcome, not an error.

## Storage model

Canonical Prisma fragment: `prisma/community-merchant-mcc.prisma`.

`CommunityMerchantMCCObservation` deliberately has **no relation to User, account, or device tables**. It is an anonymous evidence row, not a financial transaction record.

Raw rows are retained for at most **180 days** for contribution to results. Opportunistic cleanup removes older rows; queries ignore rows outside the retention window even before cleanup runs.

## Abuse and privacy controls

The service cannot safely claim independent-user corroboration because it deliberately stores no contributor identity. Therefore it uses time and physical scope as bounded anti-burst evidence rather than pretending three reports mean three people.

Current controls:

- submission body: max 8 KiB;
- query body: max 16 KiB;
- query: max 25 candidate stores;
- submitted observation: no more than 30 days old and no more than 10 minutes in the future;
- coordinates normalized to the shared 3-decimal bucket;
- raw storage cap: 12 rows per physical merchant scope per UTC day (best-effort under concurrent submissions);
- aggregate influence cap: 2 evidence units per physical scope/network/MCC/day;
- publication threshold: support on at least 3 distinct days;
- query read: each unique candidate scope is independently bounded to 2,172 rows (the 180-day window can touch 181 UTC dates); one extra sentinel row records a cap overage without allowing that scope to starve another candidate;
- retention: 180 days.

Same-day request volume therefore cannot manufacture the three-day publication threshold. Conflicting MCCs remain separate fractional aggregate signals rather than last-write-wins truth.

## Trust boundary

MoneyTalks returns community signals; it does **not** certify an MCC as true.

PickMe decodes community results as `externalLocationReport` evidence and keeps their confidence below direct owner observations. Community evidence can improve or challenge an editorial prior, but it cannot make a `MerchantMCCPrediction` trusted. Trusted terminal truth still requires repeated direct owner MCC observations.

This distinction must survive any backend rewrite.

## Operational observability

MoneyTalks records only aggregate, low-cardinality OpenTelemetry metrics:

- `community.merchant_mcc.submissions` — accepted / duplicate / capped / validation / failure outcomes;
- `community.merchant_mcc.queries` — success / health / validation / failure outcomes;
- `community.merchant_mcc.query_volume` — aggregate candidate, returned-signal, and per-candidate-truncation counts.

Metric attributes must never contain merchant ids, MCCs, coordinates, place ids, observation UUIDs, user/device/account identifiers, IPs, or raw request headers.

The GitHub workflow `.github/workflows/community-mcc-live-smoke.yml` probes the production GET health endpoint after relevant production-code pushes. Normal CI separately pins parsing, three-day corroboration, same-day burst resistance, conflict preservation, and PickMe-compatible coordinate normalization.

## Important reliability choice

A successfully persisted observation remains successful even if opportunistic retention cleanup fails afterward. Returning a 500 after the insert would cause PickMe to retry a row that is already safely stored. Cleanup failure is logged for operations instead.

## Current scaling limit

The query route performs one bounded `findMany` per unique candidate scope, then aggregates in application code. Its normal maximum is 2,172 rows per scope, matching the storage cap across an elapsed 180-day window that can span 181 UTC dates. It reads one additional row as a sentinel and emits aggregate-only truncation telemetry before excluding that extra row from aggregation.

This prevents busy stores from crowding quieter candidates out of the same request. Do not solve a per-scope truncation signal by repeatedly raising the cap. When production volume/latency shows this becoming material, move aggregation into Postgres, for example with:

- date-bucketed grouped queries;
- per-candidate bounded aggregation;
- a materialized/rollup table keyed by coarse store scope + network + MCC + UTC day;
- or another measured design that preserves the same evidence/privacy semantics.

The raw observation table can remain the auditable short-retention input while a derived aggregate table becomes the query path.

## Replaceable decisions

Future agents are explicitly allowed to replace:

- Prisma/Postgres implementation;
- aggregation algorithm;
- storage/rollup layout;
- retention window if product/legal evidence supports a change;
- coordinate bucketing if a better privacy/accuracy tradeoff is measured;
- transport protocol or hosting;
- abuse controls;
- community confidence formula (owned by PickMe today).

A replacement should be preferred when it demonstrably improves accuracy, cost, latency, privacy, abuse resistance, or operational simplicity.

The invariants that should **not** be casually removed are:

1. opt-in sharing and local/offline fallback;
2. no account/bank linking requirement;
3. exact shared MCC evidence must be distinguishable from inference;
4. no user/device identity is required for the anonymous graph;
5. location scope remains coarse enough not to become a visit-history service;
6. contradictions remain visible evidence, not last-write-wins truth;
7. backend evidence remains weaker than repeated direct owner evidence;
8. schema changes are versioned;
9. recommendation semantics stay in PickMe.

## High-ROI next checks

Prioritize evidence over sophistication:

1. Measure production submission/query outcomes and returned-signal coverage.
2. Measure in PickMe whether runtime MCC evidence changes the top MCC and, more importantly, whether plausible MCC branches change the winning card.
3. Improve seed/community acquisition only where MCC uncertainty is decision-sensitive.
4. Move query aggregation into Postgres only when the 5,000-row application aggregation is measurably becoming a limit.
5. Evaluate automatic exact-MCC providers later through the same evidence interface; do not couple provider APIs directly to card recommendation logic.

## Verification

MoneyTalks CI must remain green, and the production smoke must return HTTP 200 with `{ "ok": true, "schemaVersion": 1 }` before treating backend changes as production-ready.
