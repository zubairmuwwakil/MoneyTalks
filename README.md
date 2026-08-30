# In Unity

A privacy-first personal finance command center and transaction operating system: zero-bank-login Apple Pay capture, multi-currency ledger, cashflow forecasting, and statutory tax/benefit compliance engines.

- **Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS + shadcn/ui · Prisma + Postgres (Neon) · Clerk · Vercel
- **Consumer Domain:** [`inunity.ca`](https://inunity.ca)
- **Privacy by construction:** The repo contains zero personal data — all records enter at runtime through authenticated client imports or secure iOS Wallet webhooks. No bank-login scrapers (Plaid/Flinks) are used.

---

## 1. Standalone Product Capabilities

In Unity functions independently as a complete personal finance platform built around **direct device transaction capture**:

- **Zero-Bank-Login Apple Pay Capture**: An iPhone Wallet Automation + Apple Shortcut captures Apple Pay tap events and posts authenticated transaction payloads directly to your personal In Unity ledger in real time without third-party aggregator passwords.
- **Multi-Currency Net Worth**: Live tracking with CAD / USD / JMD denomination toggles and automated FX rate synchronisation via the Bank of Canada Valet API.
- **12-Month Bill & Cashflow Forecast**: Forward-looking projection engine with customizable cash cushions that flags upcoming payment pile-ups and rolling minimum-balance dips.
- **Money Finder (Statutory Rules Engine)**: 24 citation-backed compliance checks for cross-border filing (FBAR, Form 8938, PFIC, T1135) and Canadian wealth/benefit opportunities (RDSP grants & bonds, FHSA contribution room, DTC, CWB) with printable tax checklists.
- **Private Receipt Storage**: Private blob storage for PDF/image receipt attachments, served only through authenticated routes.

---

## 2. Ecosystem Unification (Optional)

In Unity also serves as the central command hub of the **Zemi Echelon** financial ecosystem, optionally unifying three specialized sibling products:

| Sibling Product | Repository | Role in Ecosystem | Integration Surface |
|---|---|---|---|
| **PickMe** | [`PickMe`](../PickMe) | **Card Copilot (*Before Purchase*)** | Reconciles checkout card recommendations against actual posted statement purchases via a synchronized TypeScript twin engine. |
| **MarketLens** | [`marketdata`](../marketdata) | **Asset Valuation (*Daily Closes*)** | Consumes MarketLens over HTTP to price dynamic equity holdings and technical indicators without storing user credentials. |
| **Looply** | [`return-saas`](../return-saas) | **Email & Receipt Intelligence** | Ingests parsed purchase receipts, return deadlines, and subscription renewal alerts into the central purchase spine. |

---

## Development

### Setup

```bash
cp .env.example .env.local   # fill in real values
npm install
npx dotenv -e .env.local -- npx prisma migrate dev
npm run dev
```

For an isolated local database, Docker is already supported by the repository:

```bash
npm run db:up
# use postgresql://inunity:inunity-local-only@localhost:5432/inunity
# as DATABASE_URL and DIRECT_URL in .env.local
npx dotenv -e .env.local -- npx prisma migrate dev
```

Production deploys run the schema migration as a separate release step before
the application build. Use `npm run db:migrate:deploy` with `DIRECT_URL` set to a
direct Postgres endpoint, then run `npm run build`. This keeps application
instances from racing migrations during a rolling deploy.

### Environment variables

`.env.example` is the complete checklist. For local development, copy it to
`.env.local` and fill it there; `.env.local` is ignored by git and must never be
committed. Values come from the corresponding provider dashboards:

| Need | Variables | Where to get them |
|---|---|---|
| Database | `DATABASE_URL`, `DIRECT_URL` | Neon: **Connect**. Use the pooled URL for runtime and the direct URL for migrations. Local Docker uses the URL shown above. |
| Authentication | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk Dashboard → **API Keys**. |
| Email | `RESEND_API_KEY`, `EMAIL_FROM`, `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM` | Resend Dashboard → **API Keys** and a verified sending domain. |
| Gmail ingestion | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google Cloud Console → **APIs & Services → Credentials**. Add the callback URL shown in `.env.example`. |
| Background jobs | `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `CRON_BASE_URL` | Upstash QStash console for credentials; `CRON_BASE_URL` is the stable deployed host serving `/api/cron/*`. |
| Error tracking | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | Sentry project settings and organization auth settings. |
| Private files | `BLOB_READ_WRITE_TOKEN` | Vercel project → **Storage → Blob**. |
| Market data | `MARKETLENS_API_KEY`, `MARKETLENS_BASE_URL` | The deployed MarketLens service owner; this is the hub consumer credential, not a provider key. |
| Deployment | `DEPLOYMENT_VERSION`, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, `OTEL_*` | Set by your deployment/release system. Use an immutable deploy identifier and a shared action-encryption key across instances. |

Set local values in `.env.local`. For Vercel, use Project → **Settings →
Environment Variables**, choosing Development, Preview, or Production for each
value, then redeploy. For a GitHub Actions migration job, store `DIRECT_URL` in
Repository → **Settings → Secrets and variables → Actions**; the current CI
verification job does not need production secrets. `QSTASH_TOKEN` is needed by
the schedule-sync command, while the signing keys are needed by the deployed
cron routes.

Open [http://localhost:3000](http://localhost:3000).

### Verification & Tests

```bash
npm test        # Run unit & domain engine test suite (~750 tests)
npm run lint    # Run ESLint validation
npm run build   # Production Next.js build
npm run e2e     # Playwright end-to-end test suite
```

### Scheduled Jobs

Background processing uses QStash:
- `/api/cron/digest`: Every 15 minutes.
- `/api/cron/notify`: Hourly.
- `/api/cron/purchase-merge`: Daily.

Long-running price and notification sweeps process bounded pages and enqueue
signed, idempotent QStash continuations when more work remains. `/api/health` is
a liveness probe; `/api/health/ready` checks the database path for deployment
readiness.

To sync schedules with Upstash QStash:
```bash
npx dotenv -e .env.local -- npm run qstash:schedules
```
