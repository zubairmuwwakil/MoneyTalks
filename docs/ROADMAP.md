# Roadmap — parked future work

The v1 spec (`docs/superpowers/specs/2026-08-14-moneytalks-design.md`) is fully shipped as of Phase 5. This file is the single parking lot for everything deliberately deferred along the way. Per the project's working agreement, none of these starts as scope creep — each begins with its own brainstorm → design → plan cycle.

## Near-term candidates (highest ROI first)

| Idea | What it is | Deferred from |
|---|---|---|
| Demo mode | A showcase instance seeded with the fictional test fixtures so visitors (e.g., recruiters) can click around the live app without seeing real data | Spec §9; noted when the repo went portfolio-public |
| Benefits calendar + ICS export | Card credit resets, free-night expiries, prepayment windows, and bill due dates as a calendar feed the phone subscribes to | CardPilot P1 / bills spec extras — never scheduled into a phase |
| Due-date reminders | Email or push N days before due dates, prioritizing pileup months | Bills spec extra #6; PWA install landed in Phase 5 but notifications did not |
| Historical FX for the net-worth series | The sparkline currently converts history at the latest rates; store dated rates and convert each point at its own date | Phase 1 plan, documented v1 simplification |
| Per-account danger months | The detector projects one cash pool; bills carry `sourceAccountId`, so a per-account projection ("this bill can't be covered by money in the wrong account") is mostly wiring | Phase 5 plan, documented v1 simplification |
| Income pay-date precision | Income events currently approximate (1st of month / every 14 days from window start); real pay anchors would sharpen the danger-month math | Phase 5 plan, documented v1 simplification |
| Variable-bill variance refinement | Rolling averages over logged actuals (water, card spend) to sharpen forecast estimates | Bills spec extra #5 |
| RDSP per-year entitlement tracking | The CDSG optimizer models carry-forward as a year-count multiplier; tracking actual per-year entitlements (oldest-first payout) would match ESDC statements exactly | Phase 2 plan, documented simplification |
| PNG icon rasters | The PWA ships an SVG icon (fine on Android/Chromium); PNG rasters extend install coverage (iOS home-screen fidelity) | Phase 5 plan |

## Bigger bets

| Idea | What it is | Why it waits |
|---|---|---|
| Bank/brokerage aggregation | Live balances via Flinks/MX (Canada) or SnapTrade/Plaid | Large security surface on a self-hosted finance app; manual + CSV covers the need at personal scale |
| Multi-user product | Signup, onboarding, per-user isolation UI | Schema and rules engine are profile-driven and multi-user-ready by design; the UI and legal/disclaimer work is the actual project |
| Mortgage amortization optimizer | Full amortization model: interest saved per prepaid dollar, optimal timing vs liquidity | v1 ships the prepayment-window reminder with a rough per-$10k figure; the real model is a proper engine project |

## Deliberately out (non-goals, not future work)

- **Tax form generation** — the app flags that a form is likely required; it never fills one.
- **Mint-style budgeting/expense categorization** — different product; bills ≠ full spending tracking.
- **Jamaican tax logic beyond the NHT check** — no logic applies to a non-resident; JMD stays a display currency.
