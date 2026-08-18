# Annual Fee Renewal Dates + Unified Calendar — Design Spec

**Date:** 2026-08-18
**Status:** Approved (Zubair, 2026-08-18)
**Repos touched:** `MoneyTalks` only. PickMe and return-saas get no code changes.
**Governing decisions:** `docs/decisions/2026-08-16-one-money-app.md` — decision 3 (card *data* is a shared contract; owner state is separate), decision 5 (return-saas absorbed), Amendment A5 (iOS is a single-responsibility control centre; deep analytics is web-only).

---

## 1. What this is

Credit cards with annual fees have a decision deadline the user cannot currently see: after the fee posts, most issuers allow roughly 30 days to cancel and have it refunded. MoneyTalks stores the fee **amount** (`CreditCard.annualFeeMinor`) but nothing about **when** it lands, so the app can tell you a card costs $150 a year and cannot tell you that you have eleven days left to decide whether to keep paying it.

This spec adds that date, derives the cancel-by deadline from it, and connects it to a `/calendar` surface that also shows bills, subscription renewals, trial ends, and return-by dates — the four dated obligations already in the database with no unified view.

## 2. State of play (why this is mostly wiring, not building)

The absorption of return-saas brought over more calendar infrastructure than is currently used:

| Piece | Location | State |
|---|---|---|
| `CalendarEvent` / `EventType` types | `src/lib/utils/calendarEvents.ts` | Ported. Types `BILL_DUE`, lacks `TRIAL_END`. |
| Events API | `src/app/api/events/route.ts` | Ported and working for subscriptions + returns. **No consumer.** Declares a second, drifted `EventType`. |
| Event snoozing | `SnoozedEvent` model, honored by the events route | Working. |
| Notification scheduling | `src/lib/domain/notifications/eventNotificationScheduler.ts` | Six `schedule*` functions, one consistent pattern; `clampDayToMonth` helper present. |
| Recurrence expansion | `occurrencesBetween()` in `src/engine/recurrence.ts` | Tested. Handles `MONTHLY` / `BIWEEKLY` / `QUARTERLY` / `ANNUAL`. |
| Calendar UI | Looply's `CalendarClient.tsx` (793 lines) | **Not ported.** Deliberately not porting it — see §9. |

### 2.1 Known defect this spec fixes

`EventType` is declared twice and the copies have diverged:

- `src/lib/utils/calendarEvents.ts` — has `BILL_DUE`, lacks `TRIAL_END`
- `src/app/api/events/route.ts` — has `TRIAL_END`, lacks `BILL_DUE`

The route emits `TRIAL_END` events that the shared type says cannot exist, and bills are typed for but never queried. Collapsing these into one canonical type is a prerequisite for adding card-fee events rather than a nice-to-have.

## 3. Decisions log

| Decision | Choice | Why |
|---|---|---|
| Date storage | `feeMonthDay String?` (`"03-15"`) + `feeCancelGraceDays Int @default(30)` | Matches the `Bill.prepaymentMonthDay` and `statementDay` / `dueDay` precedents. A recurring month-day never goes stale; a stored `DateTime` needs an annual roll-forward job or the calendar silently empties. |
| Which date drives the UI | The derived **cancel-by** date, not the anniversary | "How long till I have to cancel" is the actual question. The anniversary alone announces a charge; the cancel-by date is the decision deadline. |
| Bill event source | `occurrencesBetween()` for dates, `Payment` rows for status | `Payment` rows are only created when the user marks a bill paid (`src/app/bills/actions.ts:363`) — there is no forward materialization. Cadence is therefore the source of *dates*; `Payment` supplies `billStatus: DUE \| PAID`. |
| Calendar UI | Lean MoneyTalks-native rewrite consuming `/api/events` | Avoids importing 793 lines of unaudited code and Looply's visual identity into the hub being consolidated into. The `EventType` drift is evidence the ported pieces were not audited on arrival. |
| PickMe | No code changes | The fee *amount* already exists there via the catalogue, and `PortfolioAnalyzer` already renders a keep/cancel verdict. The date is owner state, which syncs anyway. SRP holds (A5). |
| Grace period, long term | User input now; **researched per-issuer catalogue field later** | The app genuinely does not know each issuer's refund window, so v1 asks and labels it as the user's own input (A6). The durable answer is a researched, issuer-confirmed `feeGraceDays` on the card catalogue, held to the D3 sourcing bar. Blocked on the catalogue sync guardrail — see §12. |
| Zero-fee cards | Emit no events | A card whose effective fee is $0 has no decision to make. |

## 4. Schema

Two columns on `CreditCard`:

```prisma
model CreditCard {
  // ...existing fields...

  // When the annual fee posts, as a recurring month-day ("03-15"), matching
  // the Bill.prepaymentMonthDay precedent. Null means the user has not told
  // us — no events, no reminders, no guessing.
  feeMonthDay        String?
  // Issuer window, in days after the fee posts, to cancel and have the fee
  // refunded. Per-card because issuers differ. The default is the common case,
  // not a guarantee — the UI labels it as the user's own input.
  feeCancelGraceDays Int      @default(30)
}
```

Both are additive and nullable-or-defaulted, so existing rows need no backfill.

**Validation:** `feeMonthDay` matches `^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$`. `feeCancelGraceDays` is an integer in `0..180`. Day-of-month values that overflow a given month (e.g. `02-31`) are accepted at write time and resolved at read time by `clampDayToMonth`.

Note this is *deliberately different* from `statementDay` / `dueDay`, which are capped at **28** in `cardImportEntry` — an earlier draft of this spec wrongly cited them as precedent for overflow tolerance. That cap is right for them (the issuer chooses those days and avoids 29–31) and wrong here: a fee anniversary is a real calendar date, and a card opened on Mar 31 renews on Mar 31. Days 29–31 must be storable and resolved per-month at read time.

## 5. Domain module — `src/lib/cards/feeSchedule.ts`

New, pure, no Prisma imports, unit-tested in isolation.

```ts
export type FeeCycle = {
  postsOn: Date;      // the anniversary this cycle
  cancelBy: Date;     // postsOn + feeCancelGraceDays
  feeMinor: number;   // effective fee, post-waiver
  phase: "UPCOMING" | "DECISION_WINDOW";
};

export function currentFeeCycle(card, today: Date): FeeCycle | null;
```

### 5.1 The roll-forward rule

The cycle advances when the **grace window closes**, not when the fee posts. Rolling forward on the anniversary would erase the countdown at the exact moment it becomes urgent.

Given `feeMonthDay = "03-15"`, `feeCancelGraceDays = 30`, effective fee $150:

| Today | `phase` | UI reads |
|---|---|---|
| Mar 3 | `UPCOMING` | "Fee posts in 12 days — $150" |
| Mar 15 – Apr 14 | `DECISION_WINDOW` | "Cancel by Apr 14 to get $150 back" |
| Apr 15 | `UPCOMING` | next cycle: Mar 15, 2027 |

**Algorithm** (corrected during implementation): resolve the anniversary for **each of `thisYear - 1`, `thisYear`, `thisYear + 1`** via `clampDayToMonth`, and return the first whose `cancelBy >= today`.

The previous year is not optional. A grace window can cross New Year — `feeMonthDay: "12-20"` with 30 days runs to Jan 19 — so on Jan 5 the live cycle is anchored to *last* year's anniversary. The originally specified algorithm ("resolve in the current year; if the window has closed, use next year") skips that case and would jump to the following December, hiding the deadline during the two weeks it matters most. Covered by the New Year tests in `feeSchedule.test.ts`.

### 5.2 Returns `null` when

- `feeMonthDay` is null (unknown — the honest state), or
- `effectiveAnnualFeeMinor(card) === 0` (waived or fee-free; no decision exists).

The amount always comes from `effectiveAnnualFeeMinor()` in `src/lib/cards/fees.ts`, never from raw `annualFeeMinor`, so a card whose waiver conditions are active correctly disappears from the calendar.

### 5.3 Boundary semantics

All comparisons use UTC day buckets via the existing `startOfDayUTC` convention. `postsOn` and `cancelBy` are both **inclusive** — on Apr 14 the user still has the day.

## 6. Events API — `src/app/api/events/route.ts`

1. **Delete** the local `EventType` and `CalendarEvent` declarations. Import both from `src/lib/utils/calendarEvents.ts`, which becomes canonical.
2. **Extend** the canonical `EventType` with `TRIAL_END` (already emitted), `CARD_FEE_POSTS`, and `CARD_FEE_CANCEL_BY`.
3. **Extend** `source.kind` to `"subscription" | "return" | "bill" | "card"`.
4. **Add the bills query:** for each `Bill`, `occurrencesBetween(cadence, start, end)` yields due dates; `amountOn(schedule, date)` yields the expected amount; a left join against `Payment` on `(billId, dueDate)` sets `billStatus` to `PAID` when `paidAt` is non-null, else `DUE`. `autopay` passes through — both fields already exist on `CalendarEvent` and are currently unused.
5. **Add the card-fee query:** for each `CreditCard` where `currentFeeCycle()` is non-null, emit up to two events when they fall in `[start, end)`:
   - `CARD_FEE_POSTS` on `postsOn` — title `"<nickname> annual fee"`, amount = effective fee
   - `CARD_FEE_CANCEL_BY` on `cancelBy` — title `"<nickname> — cancel by today for a refund"`

Two events rather than one so both moments are visible on a month grid; both derive from a single stored anniversary.

**Event id scheme** follows the existing convention (`sub_`, `ret_`, `ref_`) so snoozing keeps working unchanged:

```
bill_<billId>_<YYYY-MM-DD>
cardfee_<cardId>_<YYYY-MM-DD>
cardcancel_<cardId>_<YYYY-MM-DD>
```

Ids must stay stable across requests — `SnoozedEvent` is keyed on them, so an unstable id silently un-snoozes a dismissed event.

## 7. Notifications

One new `NotificationType` value, `CARD_FEE_DECISION_SOON`, and one new function in `eventNotificationScheduler.ts` following the shape of the existing six:

```ts
export async function scheduleCardFeeDecisionSoon(args: {
  userId: string; cardId: string; nickname: string;
  postsOn: Date; cancelBy: Date; feeMinor: number; currency: string;
}): Promise<void>
```

- Lead days from `NotificationPreference` (reuse `billLeadDays`; no new preference column in this pass).
- Two notifications per cycle: one ahead of `postsOn`, one ahead of `cancelBy`. The second is the important one.
- `eventKey` carries the **phase**, so the two notifications do not collide on upsert:
  - `cardfee:<cardId>:posts:<postsOnISO>:lead<n>`
  - `cardfee:<cardId>:cancel:<cancelByISO>:lead<n>`
- `dismissStaleBySource` cleanup with `sourceIdStartsWith: "<cardId>:"`, matching `scheduleBillDueSoon`.
- Fired from `src/app/api/automation/suggestions/route.ts` alongside the existing `scheduleBillDueSoon` call.

## 8. UI

### 8.1 Card form (`src/components/card-form.tsx`)

Two fields beside the existing Annual Fee input:

- **Fee renewal date** — month + day selects (not a date picker; there is no year).
- **Cancel window (days)** — number input, default 30, helper text: *"Most issuers refund the fee if you cancel within ~30 days of it posting. Check your cardholder agreement."*

The helper text is deliberately hedged: the grace period is the user's input about their issuer, not a fact the app knows. This follows the A6 honesty invariant.

### 8.2 `/cards` and `/cards/[id]`

Each card with a live `FeeCycle` shows its countdown, styled by `phase` — neutral for `UPCOMING`, prominent for `DECISION_WINDOW`.

Cards with an effective fee > 0 and `feeMonthDay === null` show a "set renewal date" prompt, and `/cards` carries a one-line summary (*"2 cards with fees have no renewal date set"*). An unfilled field delivers nothing, so the nudge is the feature.

### 8.3 `/calendar`

A new route rendering a month grid plus an agenda list for the visible range, fetching `/api/events?start=&end=`. Month navigation refetches. Event colour is keyed by `EventType`; `CARD_FEE_CANCEL_BY` and `RETURN_DEADLINE` share the "deadline" treatment. Clicking an event links to its source record (`/cards/[id]`, `/bills/[id]`, `/subscriptions`, `/returns/[id]`).

The page holds **no data logic** — it is a pure consumer of `/api/events`, so any source added there later appears without touching the calendar. Nav entry added to `src/components/nav.tsx`.

## 9. Explicitly not doing

- **Not porting `CalendarClient.tsx`.** 793 unaudited lines plus Looply's visual identity, to obtain a month grid whose data layer already exists.
- **Not auto-detecting the fee from statements.** `StatementLine` is persisted as of 2026-08-17, and detecting a recurring annual-fee line is the right long-term answer under the C2 capture invariant — but it needs a year of data before it can fire. The manual field is what makes that upgrade possible later: it gives the detector something to confirm against.
- **Not adding a `CardFeeSchedule` model.** Two columns cover the current need; a table with posting history has nothing to populate it yet.
- **Not touching PickMe.** Tracked separately: render the existing `PortfolioAnalyzer` verdict alongside the cancel-by date on the wallet card, once owner state carries the field.
- **Not adding fee-decision outcome tracking.** `SnoozedEvent` already handles "stop reminding me."

## 10. Testing

| Unit | Test |
|---|---|
| `feeSchedule.ts` | Table-driven across the phase boundaries in §5.1; leap-year `02-29`; `feeMonthDay: "01-31"` resolving in February; a cycle whose grace window crosses a year boundary (`12-20` + 30 days); `null` for unset date; `null` for a fully-waived fee; inclusive boundaries on `postsOn` and `cancelBy`. |
| Events API | Card-fee events appear only inside `[start, end)`; ids are stable across two identical calls; a snoozed card-fee event is filtered; bill events carry correct `billStatus` for paid vs unpaid occurrences; zero-fee card emits nothing. |
| Scheduler | `eventKey` idempotency on repeat runs; stale notifications dismissed when a date changes. |
| Validation | `feeMonthDay` regex accepts `01-01` / `12-31`, rejects `13-01` / `00-05` / `3-5` / `""`. |

Existing suites that must stay green: `recurrence.test.ts`, `fees.test.ts`, `calendarEvents.test.ts`, `cardForBill.test.ts`.

## 11. Staging

Five independently shippable chunks. 1–2 deliver the annual-fee ask on its own; 3–5 deliver the calendar.

1. **Schema + domain.** Migration, validation, `feeSchedule.ts` + tests. No UI.
2. **Card UI.** Form fields, `/cards` and `/cards/[id]` countdowns, unset-date nudge.
3. **Events API.** Collapse the duplicate `EventType`, add `TRIAL_END` / `CARD_FEE_*` / `BILL_DUE`, wire the bill and card-fee queries. Fixes §2.1.
4. **`/calendar`.** Month grid + agenda + nav entry.
5. **Notifications.** `CARD_FEE_DECISION_SOON`, scheduler function, automation-route wiring.

Chunk 3 is the only one with a blast radius beyond its own feature — it changes a shared type — so it lands on its own with the existing calendar tests green.

---

## 12. Related: the cancel-window grace period as catalogue data

**Status:** direction agreed 2026-08-18, not scheduled. Depends on §12.1.

`feeCancelGraceDays` is a user input in this spec because the app does not know each issuer's actual refund window. The durable answer is a researched, issuer-confirmed field on the card catalogue — the same sourcing bar decision D3 holds new cards to — with the per-card value taking precedence and the user input remaining as an override for cards the catalogue does not cover.

That upgrade is **blocked on the catalogue sync guardrail below**, because adding a field to the catalogue requires both consumers to tolerate it, and today MoneyTalks' copy does not receive PickMe's changes at all.

### 12.1 Catalogue drift (discovered 2026-08-18)

`PickMe/contracts/` is canonical. `MoneyTalks/contracts/` is a vendored copy per `PickMe/docs/plans/2026-08-16-card-contract-spec.md` line 30. Measured state:

- Shared cards: **10 of 10 byte-identical.** No semantic divergence; the engines cannot disagree about any card they both know.
- MoneyTalks holds a **strict subset** — PickMe has grown to 20 cards.
- Schema differs by one line: PickMe's `programId` enum gained 8 values.
- **Both files declare `catalogueVersion: 1.0`.** This is the root failure — the version field cannot distinguish the two, so neither side can detect staleness.

**Cause — a guardrail that checks the wrong invariant.** Task (b) *was* built: `scripts/sync-contracts.sh` and `src/lib/contracts/contracts.test.ts` both exist, and CI runs the test. It has been green throughout the drift, because:

1. **The manifest is self-referential.** `sync-contracts.sh` copies from PickMe and then regenerates `MANIFEST.json` by hashing **the destination files it just wrote**. The manifest therefore always describes the local vendored copy. Nothing in MoneyTalks records what PickMe's files contained.
2. **The check can only detect local tampering.** `contracts.test.ts` compares vendored bytes against that self-derived manifest. It fails if someone hand-edits `MoneyTalks/contracts/`; it cannot fail when PickMe's canonical file changes, because it never looks at PickMe.
3. **The script cannot run in CI.** It reads a local sibling path (`../PickMe/contracts`), and GitHub Actions checks out a single repo.

The test's own doc comment asserts it fails "whether the vendored file changed or PickMe's did." The second half is false. This is the harder failure mode than an unbuilt guardrail: a check that exists, passes, is documented as verifying freshness, and actually verifies only integrity.

PickMe's internal `ContractsSyncTests.swift` does not have this flaw — it compares two files that both exist in its own checkout, so there is a real second party to the comparison. The pattern broke precisely where the second party lives in another repo.

**Consequence:** re-syncing is not a file copy. `src/lib/contracts/cardCatalogue.ts:57` hard-codes the closed 6-value `programId` enum, so PickMe's current catalogue fails validation on the first Scene+ card.

### 12.2 Agreed fix

| # | Change | Repo |
|---|---|---|
| 1 | `programId` becomes an **open vocabulary** (`z.string()`), matching Swift's `programId: String` and the rule the loader already applies to `family` / `kind` | MoneyTalks |
| 2 | `MANIFEST.json` gains an `_upstream` block recording the PickMe **git ref + commit sha** synced from, and the upstream sha256 of each file — so the record has a second party | MoneyTalks |
| 3 | `sync-contracts.sh` accepts a **git ref** and fetches from PickMe's public raw URLs (default: local sibling path, for offline work), and writes `_upstream` from the *source* bytes rather than the destination | MoneyTalks |
| 4 | New CI job **fetches PickMe's current `main`** and fails if any file's sha differs from `_upstream`, message: "catalogue is stale — run scripts/sync-contracts.sh" | MoneyTalks |
| 5 | `catalogueVersion` bumps **MINOR** when cards are added; MAJOR stays reserved for breaking shape changes | PickMe |
| 6 | Re-sync to bring MoneyTalks to the current 20-card catalogue | MoneyTalks |

The existing `contracts.test.ts` integrity check is **kept as-is** — catching local tampering is genuinely useful and it is correct at that job. Item 4 is a *separate* job with a different failure mode, because the two questions are different: "has our copy been edited?" needs no network; "is our copy current?" cannot be answered without one.

Item 1 is what stops this recurring: with an open vocabulary, a new loyalty program never breaks the MoneyTalks build again. Items 2–4 make staleness impossible to miss rather than impossible to happen — deliberately, per the contract spec's "manual-plus-guardrail on purpose."

**Accepted cost:** MoneyTalks CI turns red when PickMe adds a card, until someone re-syncs. That is the intended behaviour — the whole failure being fixed is that drift was silent.

Unification via a shared package or monorepo was considered and declined: the vendored-copy approach is already ratified, and "monorepo mechanics and timing" is a deliberate deferral in the decision record.
