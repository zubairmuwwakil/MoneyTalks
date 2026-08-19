# Inunity

A privacy-first personal finance command center and transaction operating system: zero-bank-login Apple Pay capture, multi-currency ledger, cashflow forecasting, and statutory tax/benefit compliance engines.

- **Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS + shadcn/ui · Prisma + Postgres (Neon) · Clerk · Vercel
- **Consumer Domain:** [`inunity.ca`](https://inunity.ca)
- **Privacy by construction:** The repo contains zero personal data — all records enter at runtime through authenticated client imports or secure iOS Wallet webhooks. No bank-login scrapers (Plaid/Flinks) are used.

---

## 1. Standalone Product Capabilities

Inunity functions independently as a complete personal finance platform built around **direct device transaction capture**:

- **Zero-Bank-Login Apple Pay Capture**: An iPhone Wallet Automation + Apple Shortcut captures Apple Pay tap events and posts authenticated transaction payloads directly to your personal Inunity ledger in real time without third-party aggregator passwords.
- **Multi-Currency Net Worth**: Live tracking with CAD / USD / JMD denomination toggles and automated FX rate synchronisation via the Bank of Canada Valet API.
- **12-Month Bill & Cashflow Forecast**: Forward-looking projection engine with customizable cash cushions that flags upcoming payment pile-ups and rolling minimum-balance dips.
- **Money Finder (Statutory Rules Engine)**: 24 citation-backed compliance checks for cross-border filing (FBAR, Form 8938, PFIC, T1135) and Canadian wealth/benefit opportunities (RDSP grants & bonds, FHSA contribution room, DTC, CWB) with printable tax checklists.
- **Private Receipt Storage**: Private blob storage for PDF/image receipt attachments, served only through authenticated routes.

---

## 2. Ecosystem Unification (Optional)

Inunity also serves as the central command hub of the **Zemi Echelon** financial ecosystem, optionally unifying three specialized sibling products:

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

To sync schedules with Upstash QStash:
```bash
npx dotenv -e .env.local -- npm run qstash:schedules
```
