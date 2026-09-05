# Community merchant MCC evidence — server decision record

**Date:** 2026-09-04
**Status:** implemented, deployed, and intentionally evolvable
**Owner:** In Unity/MoneyTalks
**Client semantic owner:** PickMe

This is the authoritative decision record for the anonymous community MCC
network: its privacy contract, wire/storage boundary, retention, abuse controls,
bounded aggregation, and production verification. It is not PickMe's MCC
resolver specification. For evidence semantics, trust hierarchy, merchant
identity learning, and client replacement standards, read the [PickMe production
architecture handoff](../../../PickMe/docs/superpowers/specs/2026-09-04-merchant-mcc-production-architecture-design.md).
For procedures, alerts, deployment, and incident response, read the [operations
runbook](../runbooks/community-merchant-mcc.md).

## Decision and ownership boundary

PickMe needs better MCC coverage without requiring bank/card linking or buying a
proprietary merchant database. MoneyTalks provides an anonymous evidence
transport and aggregation service for opted-in PickMe clients.

- **PickMe owns** merchant identity, MCC evidence semantics and confidence,
  category projection, Purchase Routes, and final card decisions.
- **In Unity/MoneyTalks owns** schema validation, the anonymous storage/network
  boundary, bounded aggregation, retention, abuse containment, telemetry, and
  production operation.
- The service returns bounded aggregate evidence only. It does not certify an MCC
  or reinterpret a report as card truth.

This permits either side to evolve independently without moving card-decision
semantics into the backend. PickMe must remain local-first: community failure
cannot block merchant discovery, checkout, or recommendation.

## Production contract

Public endpoints:

- `POST /api/community/merchant-mcc` submits one privacy-minimal literal-MCC
  observation.
- `POST /api/community/merchant-mcc/query` requests bounded aggregate evidence
  for up to 25 candidate merchant/location scopes.
- `GET /api/community/merchant-mcc/query` is a read-only DB-backed health probe;
  it returns health/schema status, never merchant data or row counts.

Wire schema version is `1`. Both repositories pin it in tests. A breaking change
requires a new version or compatibility window; never silently reinterpret v1.

The routes are deliberately public at Clerk middleware: PickMe must work without
an In Unity account. The handlers remain narrow, body-size limited,
schema-validated, and bounded. Production verification on 2026-09-04 through
`inunity.ca` proved that Vercel deployed the route, the public path bypassed
Clerk, Prisma included `CommunityMerchantMCCObservation`, and the application
could query the migrated production table. The external smoke workflow retains
`src/proxy.ts` in its trigger list because the first verification exposed a real
pre-handler `401` regression.

## Privacy and anonymous-network contract

Community sharing is a separate explicit PickMe opt-in and is off by default.
The server accepts only:

- schema version;
- a random observation UUID (the idempotency key);
- canonical PickMe merchant ID;
- coarse store-location scope (coordinate bucket or supported future place ID);
- channel;
- optional payment network;
- literal four-digit MCC; and
- observation timestamp.

The initial client sends no network value, even though the schema can represent
one, and sends `nil` for nullable `placeId`. This bootstraps coverage without
card/network information. If measured data later shows meaningful
network-dependent MCC variation, revisit the network dimension with a
privacy/value analysis.

The observation model and its telemetry must never contain a card ID/number,
amount, Wallet descriptor/raw transaction name, reward amount, bank/account
data, email, Clerk/user ID, device ID, IP-derived identity, persistent
contributor ID, raw headers, or a `User` relation. A row is anonymous evidence,
not a financial transaction record.

Coordinates are rounded to **three decimal places** (about 100 m latitude) and
combined with canonical merchant ID and channel. The bucket deliberately avoids
precise visit history and absorbs ordinary Wallet-versus-MapKit GPS drift; the
merchant qualification prevents different brands in one plaza from automatically
merging. Same-brand stores can still collide inside one cell. H3/geohash, stable
place identity, processor identity, or a hybrid key may replace it when measured
privacy, collision, or queryability benefits justify that change—never increase
precision merely because it is convenient.

## Storage, aggregation, and retention

`CommunityMerchantMCCObservation` has no relation to user, account, or device
tables. Raw rows are auditable, preserve conflicting observations and timing, and
permit later aggregation/recoding analysis. Contradictory MCCs remain separate
aggregate signals; they are not last-write-wins truth.

Rows stop contributing after **180 days**. The authenticated QStash retention
job deletes expired rows daily at 04:30 UTC through the `observedAt` index, so
retention is not on the successful public-submission path. Queries also exclude
expired evidence before cleanup runs. See the [runbook](../runbooks/community-merchant-mcc.md#retention)
for deployment and failure handling.

Each unique query candidate is read independently, bounded to 2,172 rows (the
180-day window can touch 181 UTC dates at the 12-row daily cap), plus a one-row
sentinel. A sentinel overage produces aggregate-only truncation telemetry and is
excluded from aggregation. This prevents a busy scope from starving a quieter
candidate; the normal worst case is about 54,000 rows across 25 candidates.

Raw rows plus query-time aggregation are intentionally simple, auditable, and
cheap at bootstrap scale. If measured latency, database cost, volume, or cleanup
pressure warrants it, use Postgres grouped/window queries, rollups,
materialized aggregates, partitioning, caching, or another measured design while
retaining enough raw/versioned provenance to explain conflicts and migrate
confidence safely.

## Abuse controls and honest limits

The service deliberately stores no contributor identity, so it cannot claim
independent-user corroboration. It uses time and physical scope to bound bursts:

- submission body is at most 8 KiB; query body at most 16 KiB;
- queries contain at most 25 candidate stores;
- an observation is at most 30 days old and at most 10 minutes future-dated;
- raw storage is capped at 12 rows per merchant/location/channel scope per UTC
  day, best-effort under concurrent submissions;
- one MCC contributes at most two evidence units per scope/network/day; and
- publication requires support on at least three distinct UTC days.

The count-then-insert storage cap may admit a small concurrent overage; exact
cross-request serialization is disproportionate on this anonymous, low-trust
path. The independent daily influence cap and multi-day threshold still apply.
Same-day volume therefore cannot manufacture publication, but **`supportDays >=
3` is not proof of three independent contributors**. A patient actor can submit
across days. This service is bounded, not Sybil-proof.

If abuse appears or community evidence materially affects recommendations, prefer
platform/edge rate limiting, genuine-app admission such as App Attest or
DeviceCheck, and aggregate anomaly detection before considering persistent
contributor identity. Any such identity requires an explicit privacy decision.

## Reliability and telemetry

A successfully persisted observation remains successful if post-insert retention
cleanup fails; returning `500` would make PickMe retry a safely stored row.

Use only aggregate, low-cardinality OpenTelemetry metrics:

- `community.merchant_mcc.submissions` for accepted/duplicate/capped/validation/
  failure outcomes;
- `community.merchant_mcc.queries` for success/health/validation/failure; and
- `community.merchant_mcc.query_volume` for aggregate candidate, returned-signal,
  and per-candidate truncation counts.

Metric attributes must never contain merchant IDs, MCCs, coordinates, place IDs,
observation UUIDs, user/device/account identifiers, IPs, or raw headers. The
live smoke and diagnostic meanings are operational material in the
[runbook](../runbooks/community-merchant-mcc.md).

Before calling a backend change production-ready, `npm run check` must pass and
the live smoke must return HTTP 200 with `{ "ok": true, "schemaVersion": 1 }`.

## Explicitly open

This feature does **not** resolve the 2026-08-30 question of whether
geo-derived purchase identity may teach In Unity's global `MerchantAlias` table.
Raw Wallet aliases are neither uploaded nor globally learned by this feature;
the existing review-by-**2026-12-01** remains open.

## Explicit decision — do not invest further in community evidence yet

**Decision:** do not spend further engineering effort on the community MCC
layer until it has measured multi-user traffic or observed abuse. This is a
deliberate deferral, not an overlooked backlog.

Publication requires support on at least three distinct UTC days
(`COMMUNITY_MCC_MIN_SUPPORT_DAYS`), while PickMe consumes a published result
only as `externalLocationReport`, below direct owner evidence in its trust
hierarchy. For a single user, that composition has no user-visible payoff: they
must visit the same store on three separate days before their own contribution
can be published back to them, and by then they already have stronger direct
owner evidence for that store. The anti-burst threshold is working as designed;
community evidence becomes useful only when multiple users contribute.

The privacy model is intentionally already built because it cannot safely be
retrofitted. Further work is deliberately deferred until real multi-user demand
exists:

- H3/geohash or other spatial-bucket changes;
- App Attest, DeviceCheck, or other abuse hardening;
- support-day and evidence-cap tuning;
- the optional payment-network dimension;
- rollups or materialized aggregates; and
- retention-duration tuning.

Reopen this work only when privacy-safe client telemetry shows **measured
multi-user community traffic**: multiple opted-in PickMe users are contributing
to or receiving published evidence in a way that changes or could change
recommendations, or when an abuse signal is observed (for example cap pressure,
anomalous submission patterns, or suspicious published evidence). The anonymous
service still cannot claim that a report has independent-user corroboration. Do
not reopen it merely because community evidence exists, because a design
alternative looks interesting, or to tune thresholds before they can affect a
user.

Meanwhile, do nothing further in the community layer. The scarce, actionable
signal is exact owner MCC, and the worthwhile investment is acquiring it through
statement import. PickMe records the client-side consequence in its
[production architecture handoff](../../../PickMe/docs/superpowers/specs/2026-09-04-merchant-mcc-production-architecture-design.md#community-evidence--deliberate-deferral).

The following are intentionally replaceable when a demonstrably higher-ROI
solution exists: Vercel/Neon topology; raw versus pre-aggregated storage;
support-day/evidence caps; retention duration; bucket technology/resolution;
optional network-specific aggregation; anti-abuse/admission; and an external
exact-MCC provider supplying most observations. Preserve the anonymous-network
and privacy contract unless an explicit product/privacy decision changes it.

## Server replacement standard

Replace the current implementation when it materially improves accuracy,
coverage, latency, privacy, reliability, abuse resistance, operating cost, or
user friction, while preserving these server-side invariants:

1. Schema changes are versioned; v1 is never silently reinterpreted.
2. The service accepts literal observed MCC evidence, not inferred/category/seed
   evidence disguised as exact observation.
3. Merchant/location/channel variation remains representable.
4. Contradictions and provenance remain visible/auditable rather than becoming
   last-write-wins truth.
5. Existing evidence migrates without silently gaining strength.
6. Privacy impact is no worse without an explicit product/privacy decision.
7. The anonymous boundary does not acquire a persistent contributor identity for
   convenience.
8. The backend remains evidence transport/aggregation; PickMe retains semantic
   authority under its [replacement standard](../../../PickMe/docs/superpowers/specs/2026-09-04-merchant-mcc-production-architecture-design.md#replacement-standard).

If a replacement passes these tests, update this decision and the
[runbook](../runbooks/community-merchant-mcc.md).
