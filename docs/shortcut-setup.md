# Wallet Capture — Shortcut assembly guide

Matches the server contract as of 2026-08-17 (tolerant parsing: locale currency strings, numeric-string coordinates, offset-less timestamps, empty = missing). Server: `POST /api/v1/wallet-events`.

## 0. Before the phone

1. **Deploy first.** Four migrations are pending; the deployed route will 500 on capture until `prisma migrate deploy` runs (it runs automatically in the build).
2. In the app: **/settings/wallet → New Installation** → copy the token (shown once).

## 1. Build the "Wallet Capture" shortcut

Create a new shortcut named **Wallet Capture**. Add actions in this order:

1. **Format Date** — Date: `Current Date` · Format: Custom · string: `yyyy-MM-dd'T'HH:mm:ssZZZZZ` (→ `2026-08-17T14:22:31-04:00`; the quotes around T are literal).
2. **Format Date** — `Current Date` · Custom · string: `VV` (→ `America/Toronto`).
3. **Format Date** — `Current Date` · Custom · string: `yyyyMMdd-HHmmss` (filename-safe stamp).
4. **Random Number** — between `100000` and `999999`.
5. **Text** — content: `wevt-‹Formatted Date #3›-‹Random Number›` (this is the eventId).
6. **Get Current Location** — optional but recommended. (If you ever prefer never losing a capture to a location hiccup, delete this action — everything else works without it.)
7. **Dictionary** — the payload:
   | Key | Type | Value |
   |---|---|---|
   | `schemaVersion` | Number | `1` |
   | `shortcutVersion` | Number | `1` |
   | `source` | Text | `apple_wallet_shortcuts` |
   | `eventId` | Text | ‹Text from step 5› |
   | `capturedAt` | Text | ‹Formatted Date #1› |
   | `timezone` | Text | ‹Formatted Date #2› |
   | `transaction` | Dictionary | see below |
   | `location` | Dictionary | see below |

   **transaction** sub-dictionary: `merchantRaw` Text = ‹Shortcut Input ▸ Merchant›; `transactionNameRaw` Text = ‹Shortcut Input ▸ Name›; `amount` Text = ‹Shortcut Input ▸ Amount› (tap the chip — if it offers Get: Amount / Currency Code, pick **Amount**); `currency` Text = ‹Shortcut Input ▸ Amount› chip → Get **Currency Code**; `cardRaw` Text = ‹Shortcut Input ▸ Card or Pass› (chip → **Name** if it renders oddly).

   **location** sub-dictionary: `latitude` Text = ‹Current Location ▸ Latitude›; `longitude` Text = ‹Current Location ▸ Longitude›. (Numeric strings are fine; the server coerces. Skip accuracy unless a Horizontal Accuracy detail is offered.)
8. **Save File** — File: ‹Dictionary› · Service: iCloud Drive · **Ask Where to Save: OFF** · Destination Path: `Wallet Outbox/‹Text step 5›.json` · Overwrite: ON. *(Persist-before-upload: the tap is never lost to a network failure.)*
9. **Get Contents of Folder** — `Wallet Outbox`.
10. **Filter Files** — Sort by: Creation Date · Order: Oldest First.
11. **Repeat with Each** — over the filtered files:
    1. **Get Contents of URL** — URL: `https://YOUR-DOMAIN/api/v1/wallet-events` · Method: **POST** · Headers: `Authorization` = `Bearer YOUR-TOKEN`, `Content-Type` = `application/json` · Request Body: **File** = ‹Repeat Item›.
    2. **Get Dictionary from Input** — from ‹Contents of URL›.
    3. **Get Dictionary Value** — key `accepted`.
    4. **If** ‹Dictionary Value› **has any value**:
       - **Get Dictionary Value** — key `feedback` from ‹Dictionary› → **Get Dictionary Value** — key `warning` from that.
       - **If** ‹that value› **has any value** → **Show Notification** with it → **End If**.
       - **Delete Files** — ‹Repeat Item› (allow deleting without asking).
    5. **Otherwise**:
       - **Get Dictionary Value** — key `error` from ‹Dictionary›.
       - **If** ‹value› **has any value** → **Delete Files** ‹Repeat Item› → **End If**. *(4xx = permanently invalid; retrying can never fix it. Network failures error out of the run and the file stays for next time.)*
    6. **End If** / **End Repeat**.

## 2. Per-card automation

Shortcuts → **Automation** → **+** → **Transaction** → choose one card → **Run Immediately** (not "Ask") → run shortcut **Wallet Capture** (input: Shortcut Input). Repeat for each card.

## 3. First run

Run Wallet Capture **manually once** from the app — it surfaces the Files, Location, and network permission prompts while you're watching (and sends one junk row with empty fields; that's a useful end-to-end pipe test, visible in the data review). Then make a real tap.

After the first real tap: **/purchases** shows the row; **/settings/wallet** shows the card label to map; the verdict starts appearing from the second tap on that card once mapped.

## Troubleshooting

- **Shortcut Input properties don't offer Merchant/Amount:** build the Dictionary inside the automation itself (where trigger properties are always available) and have the automation pass the finished Dictionary to Wallet Capture, which then starts at step 8.
- **`VV` prints something odd:** leave it — the ISO timestamp in step 1 carries the offset, so the instant stays correct; the server just nulls an invalid zone name.
- **Amount shows like `$6.42`:** fine — the server strips locale currency formatting (including `1 234,56 $`).
