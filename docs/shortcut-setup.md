# Wallet Capture — Shortcut assembly guide (v2)

Matches the server contract as of 2026-08-17. Key architecture fact discovered during assembly: **a called shortcut cannot see Wallet transaction properties** (Merchant, Amount…) — only the automation editor can. So each card's automation extracts the fields into a small dictionary and passes it; the shared Wallet Capture shortcut builds the envelope, saves to the outbox, and uploads. The server accepts the dictionary nested as JSON text, locale-formatted amounts ("$6.42", "1 234,56 $"), numeric-string coordinates, and offset-less timestamps.

## 0. Before the phone

1. Deploy (migrations run in the build).
2. App → **/settings/wallet → New Installation** → copy the token (shown once).

## 1. Per-card automation (2 actions — the only part repeated per card)

Shortcuts → Automation → **+** → **Transaction** → pick one card → **Run Immediately**. Add:

1. **Dictionary** — 5 items, all type Text. For each value, insert the **Shortcut Input** chip, then TAP the chip and pick the property (they appear here, in the automation editor):
   - `merchantRaw` → **Merchant**
   - `transactionNameRaw` → **Name**
   - `amount` → **Amount** (renders like "$6.42" — fine, server strips it)
   - `currency` → Amount chip → **Currency Code** (optional; delete the key if fiddly — server assumes CAD and records the assumption)
   - `cardRaw` → **Card or Pass**
2. **Run Shortcut** — Wallet Capture · Input: the **Dictionary**.

## 2. The shared "Wallet Capture" shortcut (build once)

Date formatting is done ON chips: insert a **Current Date** chip, tap it, set Date Format → Custom. No separate Format Date actions needed.

1. **Random Number** — 100000 to 999999.
2. **Text** — type `wevt-`, insert a Current Date chip (Custom format `yyyyMMdd-HHmmss`), type `-`, insert the Random Number chip. This is the eventId — real chips, no angle brackets.
3. **Get Current Location** — optional; delete if you'd rather never lose a capture to a location hiccup.
4. **Dictionary** (the payload):
   - `schemaVersion` Number `1` · `shortcutVersion` Number `1` · `source` Text `apple_wallet_shortcuts`
   - `eventId` Text = ‹Text step 2›
   - `capturedAt` Text = Current Date chip, Custom format `yyyy-MM-dd'T'HH:mm:ssZZZZZ` (example shows like `2026-09-15T09:41:00-04:00` — correct)
   - `timezone` Text = Current Date chip, Custom format `VV`
   - `transaction` **Text** = the plain **Shortcut Input** chip (the dictionary passed by the automation; it nests as JSON text and the server parses it)
   - `location` Dictionary = `latitude` Text ‹Current Location ▸ Latitude›, `longitude` Text ‹Current Location ▸ Longitude›
5. **Save File** — ‹Dictionary› · iCloud Drive · Ask Where to Save OFF · path `Wallet Outbox/‹Text step 2›.json` · Overwrite ON.
6. **Get Contents of Folder** — `Wallet Outbox`.
7. **Filter Files** — sort Creation Date, Oldest First.
8. **Repeat with Each** file — every action below goes INSIDE the loop (above End Repeat), or "Repeat Item" won't be offered as a variable:
   1. **Get Contents of URL** — `https://YOUR-DOMAIN/api/v1/wallet-events` · POST · headers `Authorization: Bearer YOUR-TOKEN`, `Content-Type: application/json` · Request Body: **File** = ‹Repeat Item›.
   2. **Get Dictionary from Input**.
   3. **Get Dictionary Value** `notification` → **If** ‹Dictionary Value› has any value → **Show Notification** ‹Dictionary Value› → **End If**.
   4. **Get Dictionary Value** `final` from ‹Dictionary› → **If** ‹Dictionary Value› has any value → **Delete Files** ‹Repeat Item› → **End If**.
   5. End Repeat.

   No Otherwise branches needed: the server marks every definitive verdict (success, duplicate, or permanent 4xx rejection) with `final: true` → delete the file. Transient failures (network down, 5xx) either abort the run or fail the JSON parse, so the file stays for retry. `notification` is ready-to-show text, present only when a card warning exists.

## 3. First run

Run Wallet Capture manually once to surface Files/Location/network permission prompts (it sends one junk payload that the server rejects and the 4xx rule cleans up — a useful pipe test). Then tap something real. Afterward: /purchases shows the row; /settings/wallet shows the card label to map; verdicts start once mapped.

## Troubleshooting

- **No Merchant/Amount properties when tapping Shortcut Input inside Wallet Capture** — expected; that's why extraction lives in the automation (§1).
- **`VV` prints something odd** — harmless; capturedAt carries the offset so the instant stays correct.
- **Amount renders as `$6.42` / `1 234,56 $`** — fine; the server normalizes locale currency text.
