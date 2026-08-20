# Ecosystem narrative — positioning, NOT a backlog

**Status:** owner-authored 2026-08-18. **Role:** explains *why* four repos exist
and how the story is told. **Authority:** governs *identity* only — names, brands,
capability ownership, narrative. It does **not** authorize work.

> **Agents:** feature lists below describe an eventual product. Before proposing
> anything from them, check the horizon buckets in `ECOSYSTEM.md` and the decision
> record. "The command center can show X" is not a ticket for X.

Short operational summary: `ECOSYSTEM.md` (mirrored into all four repos).
Binding scope decisions: `docs/decisions/2026-08-16-one-money-app.md` + `LOG.md`.

---

## Core premise

Four related but intentionally distinct products. The separation is deliberate:
each began by solving a different problem, and the eventual unification tells a
stronger product and engineering story.

- **PickMe** solves what to use *before* a purchase.
- **In Unity** (the unifier) captures what happened *after* the purchase.
- **Looply** understands purchases and obligations *from email*.
- **MarketLens** understands *investments and market value*.

Combining them creates a much more powerful personal-finance product.

**Do not** assume the goal is to collapse everything into one repo, one brand, or
one indistinguishable application. Products share infrastructure, schemas, and
data where appropriate while preserving their individual identities. *(Consistent
with decision 1, which rejected a single merged codebase.)*

---

## 1. PickMe — Card Copilot

`PickMe` · native iOS / SwiftUI.

**Single-purpose job:** tell the user which credit card to use right now to
maximize rewards — from location/merchant, merchant category, cards owned, base
and accelerated rates, spending caps, FX fees, acceptance, reward valuations, and
other card rules.

Walk into Starbucks → PickMe says "use your Amex Cobalt." It stays fast and
focused. **PickMe = BEFORE the transaction.**

> Delivery is now ambient (Amendment A2): geofenced local notifications, not
> "open app → pick card." Firing rule in A3 — silence is the default state.

## 2. In Unity — Financial Command Center

`MoneyTalks` is the working repo name. Consumer name **In Unity** (`inunity.ca`),
ratified 2026-08-18 per E1.

It did not begin as an aggregator. Its original feature was a clever Apple
Wallet / Shortcuts transaction capture system: an iPhone Wallet automation sends
Apple Pay transaction information to the backend.

```
Apple Pay purchase → iOS Wallet Automation → Shortcut → API → purchase ledger
```

That gives it its own ingestion source. It evolves from *"automatically capture
what I spend through Apple Pay"* into *"understand my entire financial life."*

**Eventual surfaces — tagged by horizon, not a work queue:**

| Surface | Horizon |
|---|---|
| transaction history, purchase spine | **v1** |
| returns / refunds / trials digest | **v1** |
| investment values (via MarketLens) | **v1** (E2) |
| rewards earned, missed rewards, card ROI | later |
| cash flow, cash cushion, forecasting | later |
| net worth, multi-currency assets | later |
| subscriptions, bills, recurring expenses | later |
| cross-border tax/compliance rules | later (seasonal differentiator, not the front door) |
| bank aggregation (Plaid/Flinks) | **never on this path** (A1) |

**In Unity = AFTER the transaction + the overall command center.**

## 3. Looply — email financial intelligence

`return-saas` · Next.js / Prisma.

**Premise:** an inbox already contains enormous financial information. Extract it
automatically instead of making the user track everything manually. It parses
email without requiring an LLM as the core mechanism: receipts, purchases, bills,
subscriptions, free trials, renewals, return deadlines, refunds.

Where the Wallet Shortcut sees Apple Pay, Looply sees transactions and
obligations that may never touch Apple Wallet.

```
Amazon purchase → confirmation email → parser → structured purchase
Netflix renewal email → parser → detected subscription
```

> **Status correction (B1 + 2026-08-18):** this describes a *capability*, and the
> capability has already moved into the hub — `src/lib/domain/receipts/`,
> `src/lib/services/email.ts`, `src/lib/security/emailConnectionSecrets.ts`. The
> `return-saas` repo is the husk: its deployment stays live indefinitely as a
> recruiter-facing portfolio demo, explicitly not a product. No feature work.

## 4. MarketLens — investment & market data intelligence

`marketdata` · Java / Spring Boot / PostgreSQL.

Market-data ingestion, OHLCV history, daily/latest pricing, split adjustments,
corporate actions, market calendars, technical indicators (RSI/EMA/MACD),
portfolio valuation, investment performance, data-quality controls, market-data
APIs.

**The unifier consumes MarketLens rather than independently implementing another
market-data system.** MarketLens owns *investments + market data*; the unifier
owns *the complete financial picture*.

Describe MarketLens as providing **daily/latest** market pricing, **not** true
real-time, unless the infrastructure changes.

> **Clarification (E4):** MarketLens gains a Yahoo-sourced `YahooDailyProvider`
> alongside Alpha Vantage, because Alpha Vantage's free tier cannot serve
> per-user holdings. This *upholds* the rule above rather than contradicting it —
> the alternate source lives inside MarketLens, so the unifier still consumes one
> owner of market data and never re-implements it.

---

## The key ecosystem insight

Originally these solved separate problems: *"what card should I use?"* ·
*"what purchases, bills and subscriptions are hiding in my email?"* ·
*"what are my investments worth?"* · *"how do I automatically capture my
real-world Apple Pay spending?"*

The larger realization: **these are all different sensors and decision engines
describing the same person's financial life.** That leads to the unifier.

```
                    BEFORE PURCHASE
                          |
                       PICKME  "Which card should I use?"
                          |
                       PURCHASE
              +-----------+-----------+
         Apple Pay               Email / Online
              |                       |
      Wallet Shortcut               LOOPLY
       transaction capture      receipt / bill /
              |                 subscription parser
              +----------+------------+
                         |
                  PURCHASE LEDGER
            +------------+------------+
            |            |            |
       Card/reward    Cash flow    Returns /
        analysis      & bills      subscriptions
            |
            |       MARKETLENS
            |       investments, market prices,
            |       portfolio value
            +------+-----+
                   |
          THE UNIFIER — Financial Command Center
                   |
          Complete financial picture
```

### PickMe + capture form a closed loop

PickMe before: "use your Cobalt here." Capture after: "you spent $8.47 at
Starbucks using Cobalt." The system can then verify which card was recommended,
which was actually used, what it cost, what rewards should have been earned,
whether the recommendation was correct, and how the strategy performs over time.

```
Recommend → Purchase → Capture → Verify → Measure → Learn → Better recommendation
```

Potentially much more valuable than a static "best credit card" calculator.

> Bound by the honesty invariant (A6): estimates labeled, misses attributed
> honestly *including "we recommended wrong,"* eligibility-gated metrics,
> `nil` over flattery.

### Multiple sensors, one ledger

```
Apple Pay Shortcut ---+
Looply / email -------+
CSV / statement ------+--> canonical financial ledger
Manual entry ---------+
Future bank connection +   (never on this path — A1)
```

Meaningful automatic tracking without expensive Plaid/Flinks integration.

---

## Product boundaries to preserve

| Product | Owns |
|---|---|
| PickMe | card recommendation intelligence |
| Looply | email-derived financial intelligence *(capability now hosted in the hub)* |
| MarketLens | market / investment data |
| In Unity | Apple Pay capture, canonical financial view, cross-product analytics and orchestration |

They expose APIs and shared schemas to one another. Separate brands do not
require duplicated implementations.

## Why keeping the products separate matters

Part of the objective is storytelling:

- **Chapter 1 — PickMe:** a location-aware credit-card recommendation engine.
- **Chapter 2 — Looply:** passive financial ingestion from email.
- **Chapter 3 — MarketLens:** a Java/Spring market-data and analytics platform.
- **Chapter 4 — In Unity:** Apple Pay transaction capture, and the realization
  that the datasets generated by all three become substantially more powerful
  combined.

The final insight: instead of building a generic personal-finance dashboard from
scratch, several independently useful systems gradually converged into a
financial operating system. That evolutionary story is intentional.

## Rebrand requirement

**RESOLVED 2026-08-18 — the name is In Unity** (`inunity.ca` purchased). E1
superseded D1, which had set the consumer brand to PickMe. The rename applied
**only** to the unifier — PickMe, Looply and MarketLens keep their names.

Ideally: short and memorable · consumer-friendly rather than corporate · works
for a broad financial product, not just budgeting · represents having one's
financial life understood in one place · accommodates spending, investments,
cards, bills, subscriptions, taxes · preferably 1–2 syllables and roughly 6–8
letters · practical domain strategy · distinctive enough to brand and search ·
avoids generic AI-generated fintech names unless genuinely excellent.

An exact `.com` is desirable, but brand quality should not automatically be
sacrificed for one — `get[name].com` / `use[name].com` may be acceptable.

Repos keep their working names. D1's CIPO Nice 9/36/42 clearance transfers to
In Unity before public launch, and has a known obstacle: an unrelated software
company (inunity.com) holds the name in classes 9 and 42. Class 36 appears open.
The criteria above are retained as the record of what the choice was made against.
