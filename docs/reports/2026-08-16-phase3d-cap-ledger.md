# Phase 3d cap ledger

`CapUsageLedger` is the server read model for observed cap use. Each applied
source has one `CapAccrual`, keyed by `wallet:<WalletEvent.id>` or
`purchase:<Purchase.id>`, so a retry cannot increase a cap twice and a reversed
WalletEvent can subtract precisely its original period delta.

The ledger uses the TypeScript `RuleMatcher` and the contract cap attached to
the winning rule. Calendar-month and account-year keys are computed in
`America/Toronto`. The account-year anchor is resolved only from the declared
owner-state pointers `scotiaAccountYearAnchorMonth` and
`rogersAccountAnniversaryMonth`; an absent anchor does not accrue.

`resetTimeZone` remains unimplemented in this chunk. This is intentional and
explicit: even a cap that declares another reset zone currently uses the
Toronto ledger-window assumption. USD-measured caps use the twin's existing
`usdEquivalent` fallback (`amountCad × 0.73`) until a source supplies an
explicit equivalent.

The spine caps endpoint overlays a current-period ledger value onto the seeded
owner-state baseline for the same cap. A baseline is retained only for caps
that have not yet received observed source data.
