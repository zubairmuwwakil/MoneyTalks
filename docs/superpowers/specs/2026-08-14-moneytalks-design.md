# MoneyTalks — Design Spec

**Date:** 2026-08-14
**Status:** Approved

## 1. What this is

A hosted, login-protected personal finance web app unifying three domains — investments, bills, and credit cards — plus a **Money Finder** module that surfaces government grants, tax credits, and benefit-program opportunities. The target user is anyone with cross-border financial exposure (the launch rule set covers US persons resident in Canada, with Jamaica supported as a display currency and content area). Single user today; the rules engine is profile-driven so opening it to more users later is an auth change, not a rewrite.

All personal data — balances, bills, card lineups, program enrollment — enters the app at runtime through an authenticated import path. None of it lives in this repository. Owner-specific context and inputs live in `docs/private/` (gitignored).

## 2. Decisions log

| Decision | Choice | Why |
|---|---|---|
| Data home | Hosted backend with login; data on a server, never in the repo | A real deployed site reachable anywhere, with phone and laptop always in sync |
| App shape | One unified app, five modules | The three domains share one skeleton: accounts → recurring obligations → dated amounts → alerts |
| Stack | Next.js (App Router) + TypeScript + Tailwind + shadcn/ui, Prisma + Neon Postgres, Auth.js (passkey + magic link), Recharts, PWA manifest, Vercel deploy from GitHub | One codebase; serverless disks are ephemeral so Postgres over SQLite; $0 at single-user scale |
| Build order | Foundation → Investments → Money Finder → Bills → Cards → Polish | The compliance/opportunity engine is the differentiator with the highest dollar stakes |
| Audience | Single user now, profile-driven rules for later | Cross-border rules already require a profile, so multi-user readiness is nearly free |
| Repo visibility | Public (portfolio) | Therefore: zero personal data anywhere in the repo — code, docs, tests, or history |

## 3. Architecture

One GitHub repo (`MoneyTalks`) auto-deploying to Vercel on every push to `main`.

Three layers, strictly separated:

1. **Domain engines** (`src/engine/`) — pure TypeScript, zero I/O. Money math (integer minor units + ISO currency code, never floats), recurrence/date generation (timezone pinned `America/Toronto`), the rules engine, the card recommendation engine. All business difficulty lives here; all unit tests target here. Engines run identically on server, client, and in tests.
2. **Data layer** — Prisma + Neon Postgres. API route handlers do auth-checked CRUD only — no business logic in routes.
3. **UI** — React server components for pages; client components only where interactivity requires. Tailwind + shadcn/ui, Recharts for charts. PWA manifest + service worker so the app installs to a phone home screen (the card picker gets used standing at a register).

### Modules

1. **Dashboard** — net worth (assets − card balances) with CAD/USD/JMD toggle; per-account cards; 30/90/365-day sparkline from snapshots; 14-day upcoming-payments strip; active alerts panel.
2. **Investments** — CRUD accounts, holdings, transactions, balance snapshots. Crypto exchanges are accounts of type `CRYPTO` whose holdings are coins with manual price entry (auto-fetch is Phase 5, best-effort).
3. **Bills** — recurring bills with effective-dated amount schedules; month view with running total and pileup highlights; 12-month cash-flow forecast; mark-as-paid actuals log (estimate vs actual for variable bills).
4. **Cards** — instant picker (category grid + fuzzy merchant search, ≤2 taps to an answer, context chips for network-accepted / foreign-currency / over-cap); wallet cheat sheet; annual-fee ROI meters with KEEP / DOWNGRADE / CANCEL verdicts; caps tracker.
5. **Money Finder** — rendered output of the rules engine: compliance warnings and money opportunities, each with severity, dollar value, plain-English explanation, citation, and "what to do next," sorted by dollar impact.

## 4. Data model

Conventions: money as integer minor units (cents) + ISO currency code; dates as ISO 8601 strings; timezone `America/Toronto`. Every table keyed by `userId` from day one (single row today).

```
Profile         { userId, residency, citizenships[], filingStatus, marginalUSRatePct,
                  dtcEligible, benefitPrograms[], rdspIncomeTier,
                  tfsaRoomMinor, rrspRoomMinor, fhsaRoomMinor, rdspContribHistory,
                  incomeSources[] { name, amountMinor, currency, cadence } }
Account         { id, type: RRSP|TFSA|RDSP|FHSA|ROTH_IRA|NON_REGISTERED|CASH|CHEQUING|CRYPTO,
                  name, institution, country, currency, isUSSitus }
Holding         { id, accountId, symbol, name, domicileCountry, quantity,
                  bookCostMinor, lastPriceMinor, priceAsOf }
Transaction     { id, accountId, type: CONTRIBUTION|WITHDRAWAL|BUY|SELL|DIVIDEND|INTEREST|FEE,
                  amountMinor, currency, date, description, dedupeHash }
BalanceSnapshot { id, accountId, balanceMinor, currency, asOf }        // append-only
Bill            { id, name, category, payee, sourceAccountId?, autopay, variable, notes,
                  cadence: { type: biweekly|monthly|quarterly|annual,
                             anchor?, weekday?, dayOfMonth?, activeMonths?, startsFrom? },
                  schedule: [{ from, to?, amountMinor, note? }] }      // effective-dated
Payment         { id, billId, dueDate, expectedAmountMinor, actualAmountMinor?, paidAt? }
CreditCard      { id, nickname, issuer, network, lastFour, country, currency, limitMinor,
                  statementDay, dueDay, aprPct, annualFeeMinor, rewards (JSON) }
CardState       { cardId, capsUsage (per cap window), creditsRedeemed[], feeRoiInputs }
FxRate          { id, base, quote, rate, asOf }
Alert           { id, ruleKey, severity, entityRef, message, action, valueMinor?, dismissedAt? }
```

Key patterns:

- **Effective-dated amounts** — a bill's amount is a timeline, not a number. `amountOn(date)` finds the schedule entry whose range contains the date. This one pattern handles promo step-ups, rate hikes, and payment-structure changes (e.g., a lump-sum bill converting to monthly instalments) with zero special cases.
- **Append-only snapshots** — FBAR needs the *maximum* aggregate during a calendar year, which cannot be computed from a mutable balance column.
- **Snapshots win** over transaction-derived balances when both exist.
- **Dedupe hash** on transactions: hash(date + amount + account + description) so CSV re-imports are idempotent.
- **Cadence generation** — pure functions per type yielding due dates in a bounded window from an anchor. Biweekly = anchor + 14n: 26 payments/yr, which necessarily produces two triple-payment months per year (position depends on the anchor). Never approximate biweekly as semi-monthly — the pileup-month math comes out wrong.

## 5. Rules engine

Location: `src/engine/rules/`. Every rule is data plus a pure function:

```ts
interface Rule {
  key: string;                    // "RDSP_CDSG"
  jurisdiction: "US" | "CA" | "JM" | "CROSS";
  kind: "compliance" | "opportunity";
  citation: string;               // where the threshold comes from
  lastReviewed: string;           // ISO date — stale rules get flagged in dev
  evaluate(profile: Profile, snapshot: FinancialSnapshot): Alert[];
}
```

A registry runs all rules **fresh on every evaluation** (dashboard/Money Finder load) — computed alerts are never stored, so they can't go stale. Only *dismissals* persist (the `Alert` table records `ruleKey` + `entityRef` + `dismissedAt`, e.g. a logged override); a dismissed alert stays hidden until its underlying facts change. The Money Finder renders results sorted by dollar impact. All numeric thresholds live in one `rules/thresholds.ts` with citations in comments — a tax-law change is a one-line, reviewable edit. Every alert carries: severity (info/warning/critical), plain-English explanation, estimated dollar value where computable, and "what to do next" text. A rule that throws is caught and surfaced as a visible "rule error" alert, never a blank page.

### Launch rule set

All thresholds below are published program/legal facts, applied to whatever profile the engine is given.

**Compliance:**
1. FBAR watcher — aggregate max of non-US accounts > USD $10,000 at any point in the year → FinCEN 114 status badge (SAFE / TRIGGERED, shows max-to-date).
2. Form 8938 watcher — thresholds by filing status (e.g., $200k year-end / $300k any-time for a single US person abroad).
3. PFIC scanner — Canadian-domiciled fund (ticker `.TO`/`.V`/`.NE` or user-flagged) in any non-RRSP account → CRITICAL alert naming the holding + fix; RRSP exempt.
4. Roth freeze — `CONTRIBUTION` on `ROTH_IRA` while residency = CA → blocking modal explaining the treaty-taint rule; override logged.
5. TFSA reality check — never label a TFSA "tax-free" for a US person; show estimated US tax drag at the profile's marginal rate.
6. US-dividend-in-TFSA withholding annotation (15% non-recoverable).
7. T1135 reminder — non-registered specified foreign property cost > CAD $100,000.
8. Contribution-room guards — TFSA/RRSP/FHSA/RDSP room from CRA figures in the profile, depleted as contributions log; over-contribution warnings.
9. Stale-data watcher — holding prices or FX rates older than 30 days → info alert (net worth, FBAR aggregates, and forecasts silently rot on stale inputs). All cross-currency math goes through the FxRate table — no implicit conversions (convention, enforced in the engine).

**Opportunities:**
10. RDSP CDSG optimizer — "contribute $X by Dec 31 → receive $Y" using the 300/200/100% match tiers, $3,500 annual grant cap, $10,500 carry-forward cap, $70k lifetime grant / $200k lifetime contribution caps; states the effective match rate. For eligible users this is the highest-ROI dollar available anywhere, and the UI says so.
11. RDSP CDSB bond — income-tested bond (up to $1,000/yr) requiring no contribution at all.
12. FHSA room — $8k/yr, $40k lifetime, carry-forward of unused room.
13. Disability Tax Credit — profile eligibility drives RDSP access + the credit amount at tax time.
14. Canada Workers Benefit — income-threshold check for low-income workers.
15. Canada Employment Amount — flat claim reminder for employment income.
16. Digital news subscription credit — claim reminder if a qualifying subscription exists in bills.
17. Income-support earnings exemptions — for users enrolled in provincial income-support programs (e.g., Ontario Works / ODSP), published earnings-exemption and clawback thresholds vs the profile's income sources; notes which asset types the programs exempt (e.g., RDSP).
18. Student-loan interest credit — accumulate interest paid per year from bill actuals; surface at tax time (non-refundable credit in Canada).
19. Mortgage prepayment window — annual reminder of a mortgage's lump-sum prepayment privilege with an interest-saved estimate (full amortization optimizer is future work).
20. Jamaica: NHT contributions-refund eligibility check (content-level; Jamaica adds no tax logic for non-residents).

The engine presents published program rules against the user's own data, with citations. It never files forms and is not financial advice; the UI says so.

## 6. Security

A finance app behind a public URL is a named honeypot; treat it accordingly.

- **Auth:** Auth.js — passkey (WebAuthn) primary, magic-link email fallback (Resend). Registration closed: an allowlist of exactly one email. Sessions in httpOnly, secure cookies. Unauthenticated API access → 401, tested.
- **Repo hygiene:** zero personal data in code, docs, tests, or git history. `seed/`, `*.seed.json`, `docs/private/`, and `.env*` are gitignored; real data is imported through an authenticated import screen or a local script pointed at the production DB, never committed. Tests use fictional fixtures only. Secrets live in Vercel env vars and `.env.local`.
- **Data minimization:** no full account numbers, roll numbers, or customer numbers anywhere in the app — last-4 only; biller portal URLs are fine. No card numbers, CVVs, or credentials, ever.
- **Transport/storage:** HTTPS enforced by Vercel; Neon Postgres over TLS.
- **Backup:** "export everything" (JSON/CSV) is the backup strategy; prompt occasionally.
- **Cost:** $0 — Vercel Hobby + Neon free tier + Resend free tier.

## 7. Phasing

Each phase ends deployed and usable. Owner-specific inputs (anchors, balances, CRA figures, program statuses, card preferences) are collected privately in the phase that needs them; the checklist lives in `docs/private/owner-context.md`.

| Phase | Delivers |
|---|---|
| 0 — Foundation | Next.js scaffold, Prisma schema, passkey login, Vercel pipeline, empty shell with nav |
| 1 — Investments | Accounts/holdings/transactions/snapshots CRUD; net worth dashboard + currency toggle; authenticated seed import |
| 2 — Money Finder | Rules engine: compliance rules, then opportunities; alerts panel on dashboard |
| 3 — Bills | Recurrence engine; bill CRUD; month view; 12-month forecast with pileup flags; mark-as-paid |
| 4 — Cards | Card data import; instant picker; cheat sheet; fee-ROI meters; caps tracker |
| 5 — Polish | CSV import with dedupe preview; January tax-season checklist generator; Bank of Canada Valet FX auto-fetch; danger-month detector (balance roll-forward vs cushion); price auto-fetch; PWA tuning |

## 8. Testing

- **Engines (Vitest, TDD):** biweekly math against known calendar facts (26 payments/yr, triple-payment months from a given anchor); amount resolution across scheduled step-ups and structure changes; every rule with triggering / non-triggering / boundary cases (a `.TO`-listed fund in a TFSA → CRITICAL PFIC; the same holding in an RRSP → no alert; a card with a $120 fee and $90 logged rewards → negative ROI badge); card-picker acceptance rules (e.g., a Mastercard-only merchant must never be answered with an Amex, regardless of rate). All fixtures are fictional.
- **API:** auth-guard tests (unauthenticated → 401); CRUD round-trips against a test database.
- **E2E (Playwright, light):** log in → add account → net worth renders.
- **Validation:** Zod at every API boundary; recurrence generators take bounded windows (no unbounded loops).

## 9. Non-goals (v1)

- Bank/brokerage API aggregation (Plaid/Flinks/SnapTrade) — manual + CSV only; design for it, don't build it.
- Tax form generation — the app flags that a form is likely required; it never fills one. Not a substitute for a cross-border accountant.
- Budgeting/expense categorization (Mint-style) — bills ≠ full spending tracking.
- Jamaican tax logic beyond the NHT check — JMD is a display currency.
- Multi-user UI (signup, onboarding) — schema and engines are multi-user-ready; UI is not built.
- Mortgage amortization optimizer — future candidate; v1 ships the prepayment-window reminder only.
- **Demo mode** — a public showcase instance seeded with fictional data (worth building when the repo starts doing portfolio duty; the fixture data from tests is the seed).

## 10. Private companion doc

Owner-specific facts — source-data locations, real amounts, account inventory, and the open-questions checklist — live in `docs/private/owner-context.md`, which is gitignored and must never be committed. If a change touches that file's concerns, verify `git status` shows it untracked before committing.
