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

## What it does

Five modules over one shared skeleton — accounts → recurring obligations →
dated amounts → alerts:

- **Dashboard** — net worth with a CAD/USD/JMD toggle, per-account cards, a
  sparkline from balance snapshots, a 14-day upcoming-payments strip, and the
  active alerts panel. One click refreshes USD/CAD from the Bank of Canada.
- **Investments** — accounts, holdings, transactions and append-only balance
  snapshots. Per-account CSV import previews the mapped rows before writing and
  skips re-imported duplicates by content hash. Crypto holdings can pull spot
  prices from CoinGecko; everything else is manual entry.
- **Bills** — recurring bills whose amount is an effective-dated timeline, a
  month view, a 12-month forecast with pile-up flags, and mark-as-paid actuals.
  Set a cash cushion and the forecast gains a min-balance column that flags the
  months a rolling projection dips below it.
- **Cards** — an instant picker (category grid plus merchant search, network and
  cap aware), a wallet cheat sheet, annual-fee ROI meters with keep / downgrade /
  cancel verdicts, and a statement analyzer that reports what a month of spend
  earned against what the wallet's best cards would have earned.
- **Money Finder** — 24 rules covering cross-border compliance (FBAR, Form 8938,
  PFIC, T1135, treaty and contribution-room traps) and benefit opportunities
  (RDSP grant and bond, FHSA room, DTC, CWB, and more), each with a citation, a
  dollar figure where computable, and what to do next. In filing season it
  assembles a printable tax checklist from the same engines.

Installs to a phone home screen as a PWA — the card picker is meant to be used
standing at a register.

Money is integer minor units end to end. The domain engines in `src/engine/` are
pure TypeScript with zero I/O, which is where the tests point. Outbound network
calls go to exactly two public endpoints (Bank of Canada Valet and CoinGecko),
carry nothing but a series code or a ticker, and are non-fatal on failure —
manual entry always works.

MoneyTalks flags that a form is likely required. It never files one, and it is
not financial advice.

## Development

    cp .env.example .env.local   # fill in real values
    npm install
    npx dotenv -e .env.local -- npx prisma migrate dev
    npm run dev

Tests: `npm test` (engines, ~230 unit tests) · `npm run lint` · `npm run build` ·
`npm run e2e` (Playwright, full flows against a test database)
