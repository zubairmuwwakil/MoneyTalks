# Community merchant MCC — production runbook

**Date:** 2026-09-04  
**System:** In Unity/MoneyTalks backend for PickMe community MCC evidence  
**Decision record:** `docs/decisions/2026-09-04-community-merchant-mcc.md`

This runbook exists so a future agent can operate, debug, replace, or scale the community MCC backend without reconstructing the original conversation.

The decision record is authoritative for privacy, retention, anonymous-network,
and abuse policy. PickMe's [production architecture handoff](../../../PickMe/docs/superpowers/specs/2026-09-04-merchant-mcc-production-architecture-design.md)
is authoritative for evidence semantics and the MCC resolver; this document
records only their operational enforcement.

## Purpose and ownership

PickMe owns merchant identity, MCC confidence, and card recommendation semantics. In Unity owns only the anonymous API/storage/aggregation boundary.

The backend should answer:

> “What bounded community evidence exists for this canonical merchant/location/channel scope?”

It must **not** answer:

> “What MCC is definitely true?” or “Which card should the user use?”

Those remain PickMe decisions.

## Production endpoints

### Submit

`POST /api/community/merchant-mcc`

Accepts one schema-versioned literal-MCC observation. The route validates payload size, schema, time bounds, coarse location scope, daily storage caps, and UUID idempotency before persisting.

Important implementation:

- `src/app/api/community/merchant-mcc/route.ts`
- `src/lib/community-merchant-mcc.ts`
- `prisma/community-merchant-mcc.prisma`

### Query

`POST /api/community/merchant-mcc/query`

Accepts up to the bounded candidate count defined by the schema and returns only aggregate signals that pass the support threshold.

The API may return conflicting MCC candidates. That is intentional; PickMe owns confidence and conflict handling.

### Health

`GET /api/community/merchant-mcc/query`

This is a read-only production probe. It performs:

```ts
prisma.communityMerchantMCCObservation.findFirst({ select: { id: true } })
```

and returns only:

```json
{"ok":true,"schemaVersion":1}
```

No merchant data or row count is exposed. A `200` therefore proves all of the following at once:

1. the production route is deployed;
2. Clerk/proxy configuration allows the anonymous route through;
3. the deployed Prisma client contains the model;
4. the application can reach its configured production database;
5. the migrated table is queryable.

A build/deployment success alone does **not** prove items 2–5.

## Permanent production smoke check

Workflow:

`.github/workflows/community-mcc-live-smoke.yml`

It calls the real `https://inunity.ca/api/community/merchant-mcc/query` hostname from an external GitHub runner and retries briefly while Vercel promotes a new deployment.

The workflow should run when any of these change:

- community MCC API routes;
- community MCC aggregation library;
- `src/proxy.ts`;
- community MCC Prisma schema;
- migrations;
- the smoke workflow itself.

Do not remove `src/proxy.ts` from the trigger list. The first production verification caught a real regression where the new route was deployed correctly but Clerk returned `401` before the handler could run.

### Interpreting failures

| Result | Meaning / first check |
|---|---|
| `401 unauthorized` | Proxy/Clerk intercepted an endpoint intended to be anonymous. Check `src/proxy.ts`. |
| `404` | Production has not promoted the route, hostname routing is wrong, or path changed. Check Vercel deployment and route path. |
| `500 internal_error` | Handler ran but Prisma/database query failed. Check migration target, generated Prisma model, `DATABASE_URL`, and runtime logs. |
| `200 {ok:true}` | DB-backed health probe passed. |
| timeout/DNS/TLS error | Production/domain/network issue; do not treat as an MCC-model bug. |

## Database model

Canonical model:

`CommunityMerchantMCCObservation`

The row is intentionally not related to `User`.

Expected data classes are limited to:

- random idempotency UUID;
- canonical PickMe merchant ID;
- optional place ID or coarse latitude/longitude bucket;
- channel;
- optional network;
- literal MCC;
- observation time;
- server creation time.

Do not add card, amount, email, Wallet descriptor, bank/account, user, or device fields without an explicit architecture/privacy decision.

## Current privacy and location rule

Coordinates are rounded to three decimal places before storage/query matching, roughly a 100 m latitude scale. The canonical merchant ID remains part of the scope key.

Reasons:

- exact visit coordinates are unnecessary;
- Wallet and MapKit coordinates can drift slightly;
- canonical merchant qualification prevents different brands in the same plaza from automatically merging.

Known limitation: two locations of the **same brand** inside one coarse cell can still collide. This is acceptable for the current bootstrap phase because community evidence is weak, but it is a trigger to evaluate a better spatial key if observed in real data.

## Aggregation contract

Current constants live in `src/lib/community-merchant-mcc.ts`.

As of 2026-09-04:

- retention window: 180 days;
- minimum support: 3 distinct UTC days;
- contribution cap: 2 evidence units per MCC/scope/network/day;
- raw storage cap: 12 rows per merchant/location/channel/day;
- future timestamps beyond a small skew are rejected;
- submissions older than the accepted submission window are rejected.

The raw storage cap is intentionally best-effort: the count-then-insert check can admit a small concurrent overage. Exact cross-request serialization would be disproportionate for this anonymous, low-trust evidence path; the separate daily influence cap and three-day publication threshold remain in force.

Each unique query candidate is read independently, up to 2,172 rows (180 elapsed days can overlap 181 UTC dates). The route reads one extra sentinel row per candidate, emits aggregate-only truncation telemetry when that bound is exceeded, and excludes the sentinel from aggregation. A busy merchant therefore cannot starve another candidate's corroborated signal.

The current design does **not** prove unique humans. `supportDays = 3` means three days, not three users.

Do not rename support days to contributors/users unless the backend actually gains a privacy-reviewed contributor proof.

## Why raw rows exist today

Raw rows preserve:

- contradictory observations;
- provenance timing;
- the ability to change aggregation later;
- auditability when tuning confidence;
- recoding/change detection opportunities.

At current scale this is simpler and safer than prematurely building a materialized aggregation pipeline.

### When to replace raw query-time aggregation

Consider rollups/materialized aggregates/partitioning only when measurements show a real problem, such as sustained latency, database cost, query-window pressure, or retention cleanup becoming operationally expensive.

Do not migrate because a more complex architecture looks cleaner on paper.

A replacement should preserve enough raw or versioned provenance to explain conflicts and migrate confidence safely.

## Retention

Rows older than the 180-day evidence window no longer contribute. QStash calls the authenticated `POST /api/cron/retention-sweep` job daily at 04:15 UTC; it deletes rows before the cutoff using the `CommunityMerchantMCCObservation_observedAt_idx` index. Retention is therefore off the public submission path.

Community MCC does not have its own retention schedule. `retention-sweep` is the single nightly job for every "delete rows past their window" domain, because each is the same indexed `deleteMany` and the QStash account has a hard schedule quota. It sweeps each domain independently, so a failure in one still sweeps the rest; it reports a per-domain deleted count, and returns `500` (alerting operators per failed domain) so QStash retries the whole job. Every sweep is idempotent, so a retry is harmless.

It is declared in `scripts/ops/qstash-schedules.config.mjs` under the frozen `moneytalks-wallet-diagnostics` schedule id — renaming a schedule id orphans the live schedule rather than renaming it. After deploying a change here, apply and verify with `npm run qstash:schedules` and `npm run qstash:check` using the release environment.

### Future upgrade trigger

If compliance needs a tighter deletion SLO than daily cleanup, reduce the schedule interval and update the QStash schedule-contract test in the same change. Do not put cleanup back on submissions.

## Abuse model

Current application-level controls bound damage but are not Sybil-proof.

What exists:

- strict schemas and payload-size limits;
- time-range validation;
- UUID idempotency;
- daily storage cap;
- daily evidence cap;
- multi-day publication threshold;
- low downstream trust in PickMe.

What does **not** exist as a semantic guarantee:

- proof of unique people;
- proof of unique devices;
- proof that a request came from a genuine PickMe binary;
- immunity from a patient multi-day attacker.

### High-ROI hardening order if abuse appears

Prefer, in order:

1. platform/edge rate limiting that does not add app-level identity storage;
2. Apple App Attest/DeviceCheck-style genuine-app admission if operationally justified;
3. stronger anomaly rules based on aggregate behavior;
4. only then consider persistent contributor identity, and only with an explicit privacy review.

Because community data is deliberately weaker than direct owner evidence, do not overbuild anti-abuse before usage or attacks justify it.

## Observability

`src/lib/observability.ts` records community MCC submission/query outcomes.

Operationally useful aggregate signals include:

- accepted / duplicate / capped / rejected / failed submissions;
- successful / failed queries;
- candidate-scope truncation count (a cap overage signal, never merchant-level telemetry);
- `401`, `4xx`, and `5xx` rates on the two route families;
- production smoke status;
- query latency and DB latency when available;
- number of published community signals and conflict rate, if added without exposing merchant/user-level data.

Prefer aggregate metrics. Do not add transaction-level telemetry merely to make dashboards richer.

## Deploying schema changes

Follow `docs/runbooks/database-migrations.md`.

Important invariant: **application builds do not run migrations**.

For a community MCC schema change:

1. update Prisma schema and migration;
2. run the normal repository checks;
3. apply the migration through the approved production migration path;
4. deploy application code;
5. require the DB-backed production smoke to pass;
6. inspect runtime errors before declaring the change complete.

If the schema is backward-compatible, prefer migration-before-code deployment. For breaking changes, use an expand/migrate/contract sequence rather than requiring an atomic deploy.

## Rollback behavior

PickMe is local-first. If the community backend is unavailable:

- local seed priors still work;
- local learned identity still works;
- local direct-owner MCC evidence still works;
- cached community evidence can be used only according to its client TTL/policy;
- failed uploads remain retryable locally;
- a backend outage must not block checkout recommendation.

This property is an architecture invariant, not an implementation accident.

## Cross-repo contract

PickMe's canonical architecture handoff is:

`PickMe/docs/superpowers/specs/2026-09-04-merchant-mcc-production-architecture-design.md`

The original seed/graph design remains useful historical/foundational context:

`PickMe/docs/superpowers/specs/2026-09-04-merchant-mcc-graph-seed-design.md`

When changing the wire contract, update both sides and tests in the same logical change. Do not let In Unity redefine confidence semantics simply because it owns the API.

## Highest-ROI future work

Re-evaluate this list using actual production evidence before implementing it.

### 1. Measure learning quality before adding more model complexity

The most valuable next data is whether learned/community MCC evidence changes decisions correctly.

Measure privacy-safe aggregates such as:

- seed-only vs learned coverage;
- community-supported merchant/location coverage;
- conflict rate between owner-direct and community evidence;
- how often MCC uncertainty actually changes the winning card;
- confidence calibration;
- recoding/staleness rate.

If the current heuristic is already decision-stable, a sophisticated ML model may have poor ROI.

### 2. Evaluate an automatic literal-MCC provider

Once account-linking economics/UX are acceptable, test whether Plaid, MX, issuer APIs, Canadian consumer-driven banking, processor/network sources, or statement import actually return ISO MCC for the target Canadian issuers.

Treat any provider as another evidence source; do not redesign PickMe around one vendor.

### 3. Add stronger admission only when community influence warrants it

App Attest/edge controls become high ROI when community evidence has enough coverage to affect many decisions or when abuse is observed.

### 4. Improve spatial identity from evidence, not theory

If the ~100 m merchant-qualified bucket produces collisions, test stable place IDs or H3/geohash resolution empirically before changing privacy precision.

### 5. Pre-aggregate only when measured scale warrants it

If raw-row query cost becomes material, introduce rollups/materialized aggregates and indexes/partitioning. Preserve evidence provenance and version the aggregation algorithm.

## Future-agent change policy

This runbook intentionally leaves implementation freedom.

A future agent is encouraged to replace Vercel, Neon/Postgres, Prisma, the aggregation algorithm, retention mechanics, spatial indexing, admission controls, or even the community backend itself if a better option materially improves ROI.

Before replacing it, prove:

1. accuracy/coverage/reliability/cost/privacy or user friction materially improves;
2. PickMe remains the semantic owner;
3. literal MCC and inference remain distinguishable;
4. local/offline recommendations still work;
5. conflicting evidence is not silently discarded;
6. migration does not make old evidence stronger by accident;
7. privacy is maintained or explicitly re-approved;
8. there is still one authoritative MCC resolver.

The objective is not to preserve this stack. The objective is to preserve trustworthy evidence and make better card decisions with the least complexity that earns its keep.
