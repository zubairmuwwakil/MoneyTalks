# Community merchant MCC evidence — 2026-09-04

Owner approval in chat authorizes a privacy-safe shared MCC evidence backend for PickMe.

## Settled

- PickMe remains the owner of merchant identity, MCC confidence, and card-decision semantics.
- In Unity/MoneyTalks provides anonymous storage and bounded aggregation only.
- Community MCC sharing is a separate explicit opt-in and is off by default.
- Uploads are limited to a literal MCC the owner explicitly reconciled, canonical PickMe merchant id, store coordinates rounded to four decimal places, observation time, and a random observation UUID.
- Uploads contain no card id/network in the initial production slice, amount, Wallet descriptor, reward amount, account, email, Clerk/user id, device id, or contributor id.
- Raw community MCC rows have no `User` relation.
- Server results require support on at least three distinct UTC days and cap one MCC at two evidence units per physical scope per day. This reduces burst poisoning without creating a persistent contributor identifier; it is not proof of three independent people.
- PickMe consumes a returned signal only as `externalLocationReport` evidence. Community data can improve a prior but can never by itself earn `.observedMcc`, `isTrusted`, or terminal verification; those remain owner-direct evidence only.
- Raw reports stop contributing after 180 days and are opportunistically deleted.
- Observation UUIDs make retries idempotent without a sent-state account/device identifier.

## Explicitly not settled

This does **not** resolve the 2026-08-30 open question about geo-derived purchase identity teaching the hub's global `MerchantAlias` table. Raw Wallet aliases are not uploaded or aggregated by this feature. The existing review-by-2026-12-01 decision remains open.
