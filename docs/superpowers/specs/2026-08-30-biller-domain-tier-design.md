# Biller domain tier: categorizing remote billers the merchant pack does not hold

Status: design ratified in chat 2026-08-30. Not yet implemented.

Adds a hub-owned sender-domain→category table and one ladder tier that reads it,
covering the remote billers — SaaS, subscriptions, service providers — that
`contracts/merchant-pack.json` does not carry and, by its own charter, should
not. First slice of the Gmail categorization work; the processor, intermediary,
and long-tail slices are explicitly out (§10).

## 1. Decisions ratified

| Question | Ruling |
|---|---|
| Where biller rows live | **A hub-owned table.** Remote billers are a purchase fact the hub owns, not a card-decision fact PickMe owns. |
| Where retail misses live | **PickMe's pack**, unchanged. `marybrowns.com`, `dominos.ca`, `petsmart.com` are Canadian retail. |
| Preventing drift | **A test failing when any domain appears in both tables.** The boundary is mechanical, not aspirational. |
| Processors | **An explicit deny-list.** `paypal.com` resolves to nothing, deliberately and permanently. |
| Tier and confidence | **New source `billerDomain` at `high`**, ranked directly after `emailDomain`. |
| Table seeding | **Owner curates first, a script proposes rows second.** Nothing self-writes. |
| Re-run | **Generalize the geo spec's script** to `reresolveCategories.ts --source=…` rather than add a second one. |

## 2. Measured state

`scripts/ops/probeCategoryBacklog.ts`, 2026-08-30:

| | |
|---|---|
| Uncategorized purchases | 217 of 290 (74.8%) |
| …`GMAIL` | **203 (93.5%)** |
| Distinct sender domains among them | 73 |
| Top 20 domains cover | 148 of 203 (72.9%) |
| Domains appearing exactly once | 51 of 73 |
| Uncategorized rows whose domain is **already** in the pack | **0** |

That last row matters: the Gmail path correctly passes `emailFromAddress` into
`resolveCategory` (`gmailReceiptProcessing.ts`), so these are genuine coverage
misses, not a recurrence of the 2026-08-26 wiring bug.

The head decomposes by *mechanism*, which is why only one slice is specified
here:

| Bucket | Rows | Mechanism |
|---|---|---|
| Remote billers — `anthropic.com` 28, `vercel.com` 15, `gigsky.com` 8, `courtreserve.com` 8, `atlassian.net` 4 | ~47 | **This spec** |
| Retail pack misses — `marybrowns.com` 9, `dominos.ca` 6, `petsmart.com` 3 | ~30 | Pack rows, PickMe-side |
| Processors — `paypal.com` 34 | 34 | Merchant extraction from subject/body |
| Intermediaries — `olo.com` 6, `narvar.com` 3 | ~11 | Possibly `bill-intermediaries.json` |
| Singleton tail | 51 | Undecided |

## 3. What this feature is actually for

**It does not clear the backlog.** `purchase.merchant` for a Gmail row is the
registrable sender domain (`"anthropic.com"`), `InlineCategoryPicker` passes that
as `rawString`, and `setMerchantCategory` both writes the alias and runs an
`updateMany` backfilling every purchase with that merchant. So roughly twenty
taps in the shipped UI clears about 150 of the 203 rows today, with no code.

The table earns its place for two other reasons:

1. **Cold start.** A new user should not have to teach the system that
   `anthropic.com` is software before their dashboard is useful. The measured
   corpus says the first twenty domains are three quarters of the problem, so a
   small curated table is most of a working experience on day one.
2. **It gets ahead of a known hazard.** `MerchantAlias` is keyed on `rawString`
   with **no `userId`** — it is global. Whoever taps `anthropic.com` first sets
   the category for every user, with no attribution, no review, and no git
   history. Seeding a reviewed table before signup opens means the shared answer
   comes from a committed file rather than from whoever tapped first. This is the
   same hazard the geo spec records as OPEN in its §11, arriving early through a
   different door.

A third, smaller win: the table carries `displayName`, so these purchases stop
rendering as bare hostnames.

## 4. Ownership

`card-ownership.md` says not to add "rule-model features, categories, or picker
capabilities anywhere in this repo," so a category table here needs an explicit
ruling rather than a quiet assumption.

The test is **who reads it**. PickMe reads the pack to categorize a *place at
checkout*. Nobody taps a card at Anthropic; there is no checkout decision to
inform. A remote-biller table therefore has exactly one consumer — the hub — and
a single-consumer table belongs with its consumer. This follows LOG 2026-08-29
directly, which rejected `billingCurrency` in the pack because "the pack is a
Canadian retail spend-category index holding none of the affected billers" and a
billing currency is "a purchase fact the hub owns rather than a card-decision
fact PickMe owns."

The corroborating tell: the pack's `_provenance` names its source as
`CanadianMerchantPreIndex.swift`. Adding `anthropic.com` to a file called
*Canadian Merchant Pre-Index* is the wrong home stated out loud.

The measured split falls along the same line without being forced —
`marybrowns.com` and `dominos.ca` are Canadian retail and go to the pack;
`anthropic.com` and `vercel.com` are remote billers and do not. Two homes for a
principled reason, not for convenience.

**This is not the duplication `card-ownership.md` guards against.** That rule
exists to stop a *second table describing the same merchants*. These populations
are disjoint by construction, and §8 makes the disjointness a test rather than a
promise.

## 5. The table

`src/lib/domain/merchants/billerDomains.ts` — a frozen `const`, matching the
house style of `PROCESSOR_PRIORS` in `resolveCategory.ts` and `CATEGORIES` in
`categories.ts`. TypeScript rather than JSON because it is authored here rather
than vendored, and because its consumers and its test all import it directly.

Keyed on the **registrable domain** as produced by `normalizeMerchantFromSender`,
so the table's keys are the same strings the resolver will look up. Never a
two-label slice: that fuses every `.co.uk` sender into one merchant, and
`emailDomain.ts` already documents why a false merge is worse than a miss.

Each row carries `category` (a `src/lib/categories.ts` token) and `displayName`.

## 6. The processor deny-list

`PROCESSOR_DOMAINS` ships in the same file, and the tier consults it **first**:
a listed domain resolves to nothing, whatever else is known.

This exists because `paypal.com` is the single most tempting row in the dataset —
34 purchases, top of every histogram — and any category assigned to it is
confidently wrong for all 34. A processor's sender domain says who moved the
money, not what was bought; it is the email-side twin of `SQ *` in a card
descriptor, which `normalizeMerchant`'s `PROCESSOR_PREFIXES` already strips for
exactly this reason.

Encoding the refusal is cheaper than rediscovering it. It also hands the
processor slice a labelled starting point rather than a blank page.

## 7. The tier

One new `CategorySource`, `billerDomain`, at `high`.

| # | Tier | Confidence |
|---|---|---|
| 4 | `emailDomain` (pack) | high |
| **4a** | **`billerDomain`** (hub table) | **high** |
| 5 | `brandPack` | high |

`high` because the evidence is identical in kind to `emailDomain` — an exact
sender-domain match, not a fuzzy one — and that tier already writes.

Ranked **after** `emailDomain` so the curated pack wins wherever both know a
domain. §8's disjointness test should make that unreachable; the ordering is
belt-and-braces for the window where a pack sync adds a row the hub table still
holds.

Its own source label rather than reusing `emailDomain`, because provenance is
what lets you measure which table is carrying load and makes promoting a row into
the pack a visible change. `InlineCategoryPicker`'s `SOURCE_LABELS` gains an
entry. Both tiers carry `representativeMcc(category)` with `mccObserved: false`,
per the standing MCC obligation.

## 8. Enforcement

A co-located `billerDomains.test.ts` asserts:

1. **No domain appears in both the table and `contracts/merchant-pack.json`'s
   `emailDomains`.** This is the drift guard, and it is the reason §4's ownership
   ruling is safe to make.
2. **No domain appears in both the table and `PROCESSOR_DOMAINS`.**
3. **Every `category` is a token `src/lib/categories.ts` offers.** Mirrors
   `categories.catalogue.test.ts`, whose failure mode is silent: a category the
   app can infer but the owner cannot select pushes real spend into whichever
   neighbouring option was on screen.
4. **Every key is its own registrable domain** — `normalizeMerchantFromSender`
   applied to the key returns the key — so no two-label slice or bare public
   suffix enters the table.

A vitest test rather than a `scripts/checks/*.mjs` guardrail because both
artifacts are importable from TypeScript and `npm run check` already runs the
suite, so this needs no new CI trigger. If it later warrants a standalone check,
that is the `add-a-check` skill's job.

## 9. Seeding and re-running

`scripts/ops/proposeBillerDomains.ts` — **read-only**. Reads curated
`MerchantAlias` rows, keeps those whose `rawString` is a registrable domain,
drops anything the pack already covers or the deny-list names, and prints
ready-to-paste table entries with the purchase count each row would resolve. The
owner reviews and commits; nothing writes itself.

Order matters and is the point: the owner categorizes from real receipts first,
the script codifies what they decided second. Same measure-then-codify move as
the currency ruling and the merchant-pack publication.

The geo spec's `reresolveGeoCategories.ts` **generalizes** to
`scripts/ops/reresolveCategories.ts --source=billerDomain|geoConfirmed`,
re-deriving categories for rows still carrying a machine source and skipping any
the owner has overridden (an override stamps `userOverride`, so the source column
is the discriminator). **Amendment owed:** §10 of
`2026-08-30-geo-category-tier-design.md` names the single-purpose script and
should be updated to the generalized one when either lands.

## 10. Not in this slice

- **Processor extraction** (`paypal.com`, 34 rows). Needs subject/body parsing.
  §6 refuses the domain rather than guessing it.
- **Intermediaries** (`olo.com`, `narvar.com`, `orderhouse.io`, ~11 rows).
  `contracts/bill-intermediaries.json` may already speak to this; unexamined.
- **The 51-row singleton tail.** Whether that is an LLM tier, more curation, or
  accepted residue is its own decision.
- **`MerchantAlias`'s global posture.** Named as a hazard in §3, unchanged here.
  LOG 2026-08-26 item (8) and the geo spec's §11 both hold this open.
