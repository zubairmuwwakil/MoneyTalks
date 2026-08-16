# Apple Wallet Transaction Capture — spec

**Status:** Approved 2026-08-16 (owner-authored design + hardening amendment; forks ratified: TS scoring twin now [record C1]; sync verdict response with ⚠-only notification). Wallet automation manually tested — the trigger exposes transaction fields cleanly.
**Parent:** decision record Amendments A4, C1, C2 · Phase 3 spec chunks 3t/3a/3b.
**Boundary (strict):** the Shortcut captures events; the backend determines what they mean. No categorization, MCC prediction, reward math, card rules, aliases, dedup, or analytics in Shortcuts — ever.

## Shortcut (user-assembled; this is the assembly contract)

Per-card Wallet/Transaction automation → runs one shared "Wallet Capture" shortcut:

1. Generate `eventId` (UUID action).
2. Read transaction fields from the trigger: `merchantRaw`, `transactionNameRaw`, `amount`, `currency` (capture if exposed, else omit — **never guess**), `cardRaw`. Preserve Apple's raw strings untouched.
3. `capturedAt` = current date, ISO-8601 with timezone offset; plus `timezone` (e.g. America/Toronto).
4. Get Current Location with a **short timeout**; capture lat/lon (+ `horizontalAccuracyMeters` if free). Any failure → `location: null` and continue. Location is requested only at transaction time — no background tracking.
5. Build the payload dictionary (below) and **SAVE it as a JSON file named `<eventId>.json` in the outbox folder BEFORE any network call** (persist-before-upload).
6. Flush the outbox: for each pending file (oldest first), POST it; on 2xx **or** `duplicate: true`, delete the file. On failure, leave it (retry happens on the next Wallet transaction / next manual run — no retry loops inside one run).
7. If this event's response contains `feedback.warning`, Show Notification with its text ("⚠ Cobalt would have earned ~$0.74 more"). Otherwise finish silently. No dialogs, no app opening.

Target UX: double-click → Face ID → tap → done. One failed upload must never slow future taps.

## Payload (schemaVersion 1)

```json
{
  "schemaVersion": 1, "shortcutVersion": 1, "source": "apple_wallet_shortcuts",
  "eventId": "0191f3e2-…",
  "capturedAt": "2026-08-16T18:25:31-04:00", "timezone": "America/Toronto",
  "transaction": { "merchantRaw": "Starbucks", "transactionNameRaw": "STARBUCKS #1234",
                   "amount": 6.42, "currency": "CAD", "cardRaw": "American Express Cobalt" },
  "location": { "latitude": 43.6532, "longitude": -79.3832, "horizontalAccuracyMeters": 18 }
}
```

Unavailable fields are `null`/omitted, never guessed. `currency: null` is valid; the server records any CAD assumption it makes as an assumption.

## API

`POST /api/v1/wallet-events` · Auth: `Authorization: Bearer <wallet-installation-token>` — a per-installation random token, **hashed at rest**, scoped to exactly this endpoint (no reads, no other writes). Generated/revocable in the app's settings; pasted once into the Shortcut during setup. No global secrets in Shortcuts (Shortcut contents are user-visible).

Idempotency: `eventId` unique server-side. Replay → `200 { accepted: true, duplicate: true, eventId }` and no new row. Response (sync, fast — scoring is milliseconds):

```json
{ "accepted": true, "eventId": "wevt_…",
  "feedback": { "verdict": "warning" | "best" | "unknown",
                "warning": "⚠ Cobalt would have earned ~$0.74 more" } }
```

`feedback.warning` present only when a better card existed AND the switch threshold was cleared (A3). `verdict: "unknown"` when card/merchant can't be resolved yet — never fabricate.

## Server model & pipeline

`WalletEvent` (raw landing table — the pattern every source follows; EmailTransaction is email's):
`id, userId, walletInstallationId, eventId (unique), source, schemaVersion, shortcutVersion, capturedAt, uploadedAt (server-stamped; never overwrites capturedAt), merchantRaw, transactionNameRaw, amountRaw, currencyRaw, cardRaw, latitude, longitude, locationAccuracyMeters, processingStatus, createdAt`.

`processingStatus`: `observed → normalized | possibleDuplicate | reconciled | reversed`. A Wallet trigger is an **observation**, not proof of a posted charge — declines, reversals, refunds, and statement reconciliation all fit this state machine later.

Async pipeline (sync only computes the verdict; everything else follows): normalize merchant (keep `merchantRaw` + `merchantNormalized`; alias table improves server-side, user's Shortcut never changes) → map `cardRaw → cardId` via alias table (never permanent exact-string matching) → categorize (location as confidence signal — "SQ *CAFE" + coffee-shop coordinates → dining — but location never blindly overrides transaction data) → accrue cap ledger (3d) → promote to the Purchase spine.

**Dedup, two layers:** exact (`eventId` — retries), fuzzy (same user+card+merchant+amount within ~60s → mark `possibleDuplicate`, don't delete, while real-world double-fire behavior is unknown).

**Privacy/retention:** precise coordinates exist to resolve the merchant/store; design so they can be truncated or deleted once resolution is done. Purchase-time location + this retention posture go into the Phase 4 compliance rewrite (A1).

## Future-compatible, not-now

APNs push (v2 verdict delivery) · CSV/statement reconciliation into the same landing pattern (3e) · physical-card ingestion · pending→posted reconciliation · refund/reversal handling · Android · merchant geofence DB. All sources converge: raw landing → normalization → reward engine → spine.

## V1 success

Seconds after an Apple Pay tap, the backend holds card/merchant/amount/time(/location), and can answer: what merchant+category, what the used card earned, which card was optimal, value gained or left on the table — with the ⚠ arriving in the tap's response when it matters. The Shortcut stays a dumb, stable transport while the intelligence evolves server-side.
