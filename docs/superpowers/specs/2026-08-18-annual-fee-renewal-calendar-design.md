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

**Validation:** `feeMonthDay` matches `^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$`. `feeCancelGraceDays` is an integer in `0..180`. Day-of-month values that overflow a given month (e.g. `02-31`) are accepted at write time and resolved at read time by `clampDayToMonth` — the same tolerance `statementDay` / `dueDay` already have.

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

Algorithm: resolve the anniversary in the current year via `clampDayToMonth`; if `anniversary + graceDays < today`, resolve it in the next year instead.

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
