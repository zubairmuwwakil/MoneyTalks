# Community merchant MCC evidence — 2026-09-04

**Status:** implemented, deployed, and intentionally evolvable.

Owner approval in chat authorizes a privacy-safe shared MCC evidence backend for PickMe. This record captures the current decision boundary, not a permanent mandate to preserve today's storage, aggregation, or hosting choices.

## Ownership boundary

- **PickMe owns** merchant identity, MCC confidence, evidence semantics, category projection, Purchase Routes, and final card-decision behavior.
- **In Unity/MoneyTalks owns** the anonymous network/storage boundary, schema validation, bounded aggregation, retention, abuse containment, and production operation of the community MCC API.
- In Unity must not reinterpret a community report as card truth. It returns bounded evidence; PickMe decides how much that evidence is worth.

This split is deliberate. It lets the backend be replaced or scaled independently without moving card-decision semantics out of PickMe.

## Current production contract

Public endpoints:

- `POST /api/community/merchant-mcc` — submit one privacy-minimal literal-MCC observation.
- `POST /api/community/merchant-mcc/query` — request bounded aggregate evidence for candidate merchant/location scopes.
- `GET /api/community/merchant-mcc/query` — read-only production health probe. It performs a Prisma query against `CommunityMerchantMCCObservation` and returns only health/schema status, never merchant data or row counts.

The community routes are intentionally public at Clerk middleware because PickMe must be able to use them without an In Unity account. The handlers themselves remain narrow, schema-validated, bounded endpoints. A production smoke workflow exercises the public hostname so an auth regression such as an accidental `401` is detected.

Production was verified on 2026-09-04 through the real `inunity.ca` hostname: the Vercel deployment succeeded and an external GitHub Actions runner received a successful DB-backed health response. This proves the deployed route can reach Prisma and query the migrated production table.

Operational details live in `docs/runbooks/community-merchant-mcc.md`.

## Privacy contract

Community MCC sharing is a separate explicit PickMe opt-in and is off by default.

The initial production submission contains only:

- schema version;
- random observation UUID for idempotency;
- canonical PickMe merchant ID;
- coarse store-location scope;
- channel;
- literal four-digit MCC;
- observation timestamp.

The initial PickMe client does not need to send card/network information to bootstrap shared coverage, even though the server schema can represent an optional network dimension.

Uploads do **not** contain:

- card ID or card number;
- purchase amount;
- Wallet descriptor/raw transaction name;
- reward amount;
- account or bank information;
- email address;
- Clerk/user ID;
- device ID;
- persistent contributor ID.

Raw `CommunityMerchantMCCObservation` rows have no `User` relation.

For coordinate-scoped observations, latitude/longitude are rounded to **three decimal places** (roughly 100 m in latitude) and combined with canonical merchant ID and channel. The coarser bucket is intentional: it reduces location precision and absorbs ordinary Wallet-versus-MapKit GPS drift. A future spatial scheme such as H3/geohash may replace it if it improves privacy, collision behavior, or queryability; do not silently increase location precision.

## Evidence and abuse model

The server intentionally does not claim to know that reports came from independent people because it stores no persistent contributor identifier.

Current protections are therefore bounded rather than identity-based:

- observation UUID is the primary idempotency key;
- submitted observations must be recent and not materially future-dated;
- raw storage is capped at 12 observations per merchant/location/channel scope per UTC day (best-effort under concurrent submissions);
- one MCC contributes at most two evidence units per scope/network/day;
- an MCC is not published until it has support on at least three distinct UTC days;
- raw observations stop contributing after 180 days and a daily authenticated job removes expired rows;
- each unique query candidate is read independently, with an aggregate-only truncation signal if its bounded read encounters a cap overage;
- PickMe consumes returned data only as weaker `externalLocationReport` evidence.

**Important limitation:** three support days are **not proof of three independent users**. One determined actor could submit across multiple days. The design bounds the impact of bursts and keeps community evidence below direct owner truth, but it is not Sybil-proof.

If community evidence becomes materially important to recommendation outcomes or abuse is observed, a future agent should evaluate stronger admission controls such as platform/edge rate limiting, App Attest/DeviceCheck-style genuine-app attestation, or another privacy-preserving anti-abuse design. Do not introduce a permanent cross-event user/device identifier merely for convenience without an explicit privacy decision.

## Trust semantics

Only a literal MCC explicitly observed/reconciled by the owner may enter the community upload queue.

Category feedback, MapKit category, reward inference, seed priors, or a guessed MCC must never be uploaded as if they were exact transaction MCC observations.

Returned community signals may improve a PickMe prior but can never by themselves create:

- `.observedMcc`;
- `isTrusted`;
- terminal verification;
- a rewrite of direct owner history.

Direct owner evidence remains stronger.

## Choices made and why

### Anonymous raw observations instead of account-linked reports

**Chosen because:** the feature can improve PickMe without requiring an In Unity account or creating a new financial-activity identity graph.

**Tradeoff:** the backend cannot prove unique contributors. The current design compensates with day/evidence/storage caps and lower downstream trust.

**Future freedom:** replace this with privacy-preserving attestation or another admission model if measured abuse/cost justifies it.

### Coarse merchant-qualified coordinate buckets

**Chosen because:** precise coordinates are unnecessary for this purpose and Wallet/MapKit GPS readings can differ. Canonical merchant ID prevents different brands in one plaza from automatically merging.

**Tradeoff:** two locations of the same brand within the same coarse bucket can collide.

**Future freedom:** H3/geohash, stable MapKit place identity, processor merchant identity, or a hybrid location key may be superior when enough data exists to measure collisions. The server deliberately retains nullable `placeId` support so a future stable location identifier can be adopted without a schema migration; PickMe schema v1 currently sends `nil` for this field.

### Per-candidate bounded reads

**Chosen because:** a global newest-first row cap let a busy candidate suppress another candidate's evidence entirely. Independent candidate reads preserve the three-day support rule for every requested scope.

**Tradeoff:** one request can issue up to 25 bounded reads instead of one OR query. The normal maximum remains about 54,000 rows across 25 candidates, and a one-row sentinel makes a cap overage observable without recording merchant-level telemetry.

**Future freedom:** use a measured Postgres rollup/window-query design when application-side fan-out is a real latency or database-cost issue.

### Raw-row storage plus query-time bounded aggregation

**Chosen because:** it is simple, auditable, inexpensive at current volume, preserves conflicting observations, and avoids prematurely committing to an aggregation pipeline.

**Tradeoff:** query cost grows with raw evidence volume.

**Future freedom:** when measured volume/latency warrants it, move to rollups/materialized aggregates/partitioning while preserving raw provenance for the chosen retention window.

### 180-day evidence window

**Chosen because:** MCC coding can change and indefinite raw history is unnecessary for the initial feature. The daily cleanup job deletes expired rows by an `observedAt`-leading index, so retention does not add work to a successful public submission.

**Tradeoff:** old but still-correct evidence expires.

**Future freedom:** tune retention/decay from observed recoding frequency, privacy requirements, and database cost. Do not lengthen retention merely because storage is cheap.

### Public community endpoints

**Chosen because:** the PickMe community feature is deliberately accountless and opt-in.

**Tradeoff:** Clerk cannot provide abuse control for this path.

**Future freedom:** use app attestation, signed installation capabilities, or edge controls if warranted, but preserve accountless/local-first PickMe operation unless the product decision changes explicitly.

## Explicitly not settled

This feature does **not** resolve the 2026-08-30 open question about geo-derived purchase identity teaching In Unity's global `MerchantAlias` table. Raw Wallet aliases are not uploaded or globally learned by this MCC feature. The existing review-by-2026-12-01 decision remains open.

The following are also intentionally open and should be changed if a demonstrably higher-ROI solution appears:

- Vercel/Neon as the long-term backend topology;
- raw-row vs pre-aggregated storage;
- exact support-day/evidence caps;
- retention duration;
- coordinate bucket technology/resolution;
- optional network-specific aggregation;
- anti-abuse/admission mechanism;
- whether an external exact-MCC provider eventually supplies most observations.

## Replacement standard for future agents

Do not preserve the current implementation for architectural purity. A replacement is preferred when it materially improves one or more of accuracy, coverage, latency, privacy, reliability, abuse resistance, operating cost, or user friction **and** it preserves these invariants:

1. PickMe still owns card/MCC trust semantics.
2. Literal observed MCC remains distinguishable from inferred/category/seed evidence.
3. Community evidence cannot silently become direct-owner truth.
4. Merchant/location/channel variation remains representable.
5. Local PickMe recommendations continue to work when the network is unavailable.
6. Existing evidence is migrated with provenance and without silently increasing its strength.
7. Privacy impact is no worse without an explicit product/privacy decision.
8. There is one authoritative MCC resolver, not parallel competing truth systems.

If a better design passes those tests, replace this one and update this record and the operational runbook.
