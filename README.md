# MoneyTalks

A personal finance command center: investments, bills, credit cards, and a
rules engine that surfaces cross-border compliance triggers and money
opportunities (grants, credits, benefit thresholds).

- **Stack:** Next.js (App Router) · TypeScript · Tailwind + shadcn/ui ·
  Prisma + Postgres (Neon) · Auth.js (passkeys + magic link) · Vercel
- **Design spec:** [`docs/superpowers/specs/2026-08-14-moneytalks-design.md`](docs/superpowers/specs/2026-08-14-moneytalks-design.md)
- **Privacy by construction:** the repo contains zero personal data — all
  personal records enter at runtime through an authenticated import path,
  and registration is closed by allowlist.

## Development

    cp .env.example .env.local   # fill in real values
    npm install
    npx dotenv -e .env.local -- npx prisma migrate dev
    npm run dev

Tests: `npm test` (engines) · `npm run e2e` (smoke)
