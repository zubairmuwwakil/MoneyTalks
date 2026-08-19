# In Unity cutover — moving the Clerk primary domain to inunity.ca

**Status:** runbook, not yet executed. Owner ruling 2026-08-18: Amendment E1 name is
**In Unity** (`inunity.ca`); trademark question closed by the owner; take option 2
(flip the Clerk primary domain) rather than a satellite or a redirect.

## Why this is not a one-click change

`inunity.ca` already resolves to the same Vercel deployment as
`moneytalks.zubairmuwwakil.com`, but **login is dead on it today**. Clerk returns:

> Production Keys are only allowed for domain "moneytalks.zubairmuwwakil.com".
> The Request HTTP Origin header must be equal to or a subdomain of the requesting URL.

Clerk production keys are locked to one primary domain, and the publishable key
encodes it: `pk_live_Y2xlcmsubW9uZXl0YWxrcy56dWJhaXJtdXd3YWtpbC5jb20k` base64-decodes
to `clerk.moneytalks.zubairmuwwakil.com`. Changing the primary domain issues a NEW key
and invalidates the old one everywhere it is embedded.

## Blast radius — read before starting

| Surface | Impact | Recovery |
|---|---|---|
| Web hub | Login breaks until the new key is deployed | env change + redeploy, minutes |
| **PickMe iOS** | **Sign-in and all spine sync break in every installed build** | **new binary via TestFlight — hours to days** |
| Existing web sessions | All invalidated; everyone signs in again | expected, unavoidable |
| Stored Gmail refresh tokens | **Survive** — they bind to the OAuth client, not the redirect URI | no user reconnect needed |
| `moneytalks.zubairmuwwakil.com` | Its login breaks once the primary moves | redirect it, or make it the satellite |

The iOS row is the one that constrains sequencing. `App/CardCopilot/Services/MoneyTalksConfiguration.swift`
hard-codes **both** `apiBaseURL` and `clerkPublishableKey` as compile-time constants, so
shipped builds cannot be repointed remotely. This is tolerable only because the product is
pre-launch (TestFlight, owner + a few testers). It would not be tolerable after public launch.

## Sequence

Steps 1–2 are additive and safe. Step 3 is the breaking moment; 4–6 should follow immediately.

1. **Google Cloud Console — additive, no downtime.**
   - OAuth consent screen: App name -> `In Unity`. Add `inunity.ca` to Authorized domains.
   - Credentials -> OAuth client -> Authorized redirect URIs: **add**
     `https://inunity.ca/api/gmail/callback`. Keep the existing one during transition.
   - Caution: this OAuth app is *published, unverified, 100-user cap* on the restricted
     `gmail.readonly` scope. Editing a published consent screen can re-trigger review.

2. **Clerk — rename only.** Application name `Money Talks` -> `In Unity`. This is what users
   read on the sign-in screen ("Continue to Money Talks" today) and in every Clerk-sent email.
   Rename the **hub's** Clerk application only — the separate Looply Clerk app stays as it is
   under decision B1.

3. **Clerk — flip the primary production domain to `inunity.ca`.** DNS is already in place:
   `clerk.inunity.ca` and `accounts.inunity.ca` resolve to Clerk. Copy the new publishable key
   (it will decode to `clerk.inunity.ca`). Register the new account-portal callback that Clerk
   displays against the Google OAuth client used for "Continue with Google".
   `CLERK_SECRET_KEY` is instance-level and does **not** change — verify rather than assume.

4. **Vercel env — then redeploy.**
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` = the new `pk_live_...`
   - `GOOGLE_REDIRECT_URI` = `https://inunity.ca/api/gmail/callback`
   - `APP_URL` = `https://inunity.ca`
   - **A redeploy is mandatory, not optional.** `NEXT_PUBLIC_*` values are inlined into the
     client bundle at build time, so changing the variable alone does nothing until rebuild.

5. **QStash — re-register.** `npx dotenv -e .env.local -- npm run qstash:schedules` with the new
   `APP_URL`. The script upserts by `scheduleId` (`moneytalks-digest`, `-notify`,
   `-purchase-merge`, `-fx`, `-prices`), so destinations update in place and no duplicates
   appear. The schedule IDs keep their old names deliberately — they are internal identifiers
   and renaming them would mean delete-and-recreate.

6. **PickMe iOS — same operation, not a follow-up.** Update `MoneyTalksConfiguration.swift`
   with the new publishable key, and `apiBaseURL` to `https://inunity.ca/` if the API host is
   moving too. Ship a TestFlight build. iOS auth stays broken until testers install it.

7. **Old domain.** Once verified, either 301 `moneytalks.zubairmuwwakil.com` -> `inunity.ca`,
   or configure it as a Clerk satellite. Deferred for now: the owner is keeping that domain
   open, and `POLICY_URL` plus the `privacy/` and `support/` copy still point at it.

## Verification

- `https://inunity.ca/login` renders the Clerk form and the button reads "Continue to In Unity".
- Browser console is clean — today it shows 8x `ERR_SSL_VERSION_OR_CIPHER_MISMATCH` plus
  `failed_to_load_clerk_js`.
- Gmail connect completes end to end (this exercises `GOOGLE_REDIRECT_URI`).
- A QStash schedule fires against the new host.
- PickMe on device signs in and syncs a wallet event.

## Related

- Amendment E1 and the naming entries in `docs/decisions/LOG.md`.
- `GOOGLE_REDIRECT_URI` was missing from `.env.example` until 2026-08-18 despite being
  non-null-asserted in `src/lib/services/gmailClient.ts` — fixed in the same commit as this file.
