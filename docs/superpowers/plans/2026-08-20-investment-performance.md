# Investment Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add honest, cash-flow-adjusted investment performance tracking from rollout onward, including daily account/position snapshots, TWR and gain calculations, mover attribution, and a restrained interactive investments workspace.

**Architecture:** MarketLens remains the canonical market-data service and continues to provide daily prices. Inunity captures user-specific daily account and position valuations after refresh, stores the exact FX and provenance inputs used, calculates performance in pure domain functions, and renders a server-loaded/client-interactive workspace. Partial or stale valuations are stored for diagnosis but excluded from performance.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript 5, Prisma 7/PostgreSQL, Recharts 3, Tailwind CSS 4, Vitest 4, Playwright 1.62.

**Spec:** `docs/superpowers/specs/2026-08-20-investment-performance-design.md`

## Global Constraints

- Read the relevant Next.js 16 guides in `node_modules/next/dist/docs/` before modifying App Router code.
- MarketLens receives symbols only; never send user ids, quantities, cash, or portfolio values.
- Daily/latest prices are not described as real-time.
- Never infer history from current quantities and never interpolate missing values.
- `CONTRIBUTION` and `WITHDRAWAL` are external flows; all other transaction types remain in performance.
- Account performance is native-currency; portfolio performance uses the CAD values and FX provenance recorded at capture time.
- Preserve unrelated working-tree changes and do not rewrite existing financial records.
- Implement each behavior test-first and run focused tests before broader suites.

---

### Task 1: Persistence model for auditable daily valuations

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260820170000_investment_performance_snapshots/migration.sql`

**Interfaces:**
- Produces: Prisma models `InvestmentAccountSnapshot` and `InvestmentPositionSnapshot` plus enum `InvestmentSnapshotStatus`.
- Produces uniqueness contracts `(accountId, asOf)` and `(accountSnapshotId, symbol)` used by capture upserts.

- [ ] **Step 1: Add the Prisma models and relations**

Add `investmentSnapshots InvestmentAccountSnapshot[]` to `FinancialAccount`, then define:

```prisma
enum InvestmentSnapshotStatus {
  COMPLETE
  PARTIAL
}

model InvestmentAccountSnapshot {
  id                       String                   @id @default(cuid())
  accountId                String
  asOf                     DateTime
  currency                 String
  cashMinor                Int
  holdingsMinor            Int
  totalMinor               Int
  netExternalFlowMinor     Int                      @default(0)
  displayCurrency          String                   @default("CAD")
  displayTotalMinor        Int
  displayExternalFlowMinor Int                      @default(0)
  fxRateToDisplay          Decimal?
  fxAsOf                   DateTime?
  status                   InvestmentSnapshotStatus
  holdingCount             Int
  pricedHoldingCount       Int
  earliestPriceAsOf        DateTime?
  latestPriceAsOf          DateTime?
  createdAt                DateTime                 @default(now())
  updatedAt                DateTime                 @updatedAt
  account                  FinancialAccount         @relation(fields: [accountId], references: [id], onDelete: Cascade)
  positions                InvestmentPositionSnapshot[]

  @@unique([accountId, asOf])
  @@index([accountId, asOf])
}

model InvestmentPositionSnapshot {
  id                      String                    @id @default(cuid())
  accountSnapshotId       String
  holdingId               String?
  symbol                  String
  name                    String
  quantity                Decimal
  priceMinor              Int
  priceCurrency           String?
  priceAsOf               DateTime
  priceSource             String?
  priceStatus             String?
  marketValueMinor        Int
  displayMarketValueMinor Int
  valuationComplete       Boolean
  accountSnapshot         InvestmentAccountSnapshot @relation(fields: [accountSnapshotId], references: [id], onDelete: Cascade)

  @@unique([accountSnapshotId, symbol])
  @@index([accountSnapshotId])
}
```

- [ ] **Step 2: Write the SQL migration explicitly**

Create the enum, both tables, foreign keys, unique indexes, and lookup indexes. The position table deliberately has no foreign key to `Holding`, so deleting a current holding cannot delete history.

- [ ] **Step 3: Validate and generate the client**

Run: `npx prisma format && npx prisma validate && npx prisma generate`

Expected: schema validates and the generated client exposes both snapshot models.

- [ ] **Step 4: Commit the persistence contract**

```bash
git add prisma/schema.prisma prisma/migrations/20260820170000_investment_performance_snapshots/migration.sql
git commit -m "feat: add investment performance snapshots"
```

### Task 2: Pure performance and attribution engine

**Files:**
- Create: `src/engine/investmentPerformance.ts`
- Create: `src/engine/investmentPerformance.test.ts`

**Interfaces:**
- Produces: `calculatePerformance(points: ValuationPoint[]): PerformanceSummary`.
- Produces: `aggregatePortfolioPoints(accounts: AccountValuationSeries[]): ValuationPoint[]`.
- Produces: `attributePositionChanges(start: PositionPoint[], end: PositionPoint[]): PositionContribution[]`.

- [ ] **Step 1: Write failing tests for no-flow, contribution, withdrawal, chaining, gaps, and zero baseline**

Use exact input types:

```ts
export type ValuationPoint = {
  date: string;
  valueMinor: number;
  externalFlowMinor: number;
};
```

Core expectations:

```ts
expect(calculatePerformance([
  { date: "2026-08-20", valueMinor: 10_000, externalFlowMinor: 0 },
  { date: "2026-08-21", valueMinor: 11_500, externalFlowMinor: 1_000 },
])).toMatchObject({ gainMinor: 500, netFlowMinor: 1_000, twr: 0.05 });
```

Also verify a withdrawal is not a loss, two daily factors chain multiplicatively, and a zero starting value begins a new segment without `Infinity` or `NaN`.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npm test -- src/engine/investmentPerformance.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal pure engine**

Return this stable shape:

```ts
export type PerformanceSummary = {
  startDate: string | null;
  endDate: string | null;
  startValueMinor: number | null;
  endValueMinor: number | null;
  gainMinor: number | null;
  netFlowMinor: number;
  twr: number | null;
  lastCloseGainMinor: number | null;
  lastCloseReturn: number | null;
  series: Array<ValuationPoint & {
    gainMinor: number | null;
    dailyReturn: number | null;
    cumulativeReturn: number | null;
  }>;
};
```

Use `(V1 - F) / V0 - 1`, chain `product(1 + r) - 1`, and assert all minor-unit inputs are safe integers.

- [ ] **Step 4: Add portfolio aggregation and position attribution tests**

Verify account points are summed by date in recorded CAD, account-opening value is treated as an external flow for the aggregate, unchanged quantities receive a contribution, and changed quantities return `eligible: false` with reason `position-changed`.

- [ ] **Step 5: Implement aggregation and attribution**

Use these types:

```ts
export type AccountValuationSeries = { accountId: string; points: ValuationPoint[] };
export type PositionPoint = { symbol: string; quantity: number; displayValueMinor: number };
export type PositionContribution = {
  symbol: string;
  contributionMinor: number | null;
  eligible: boolean;
  reason: "position-changed" | null;
};
```

- [ ] **Step 6: Run focused tests**

Run: `npm test -- src/engine/investmentPerformance.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the domain engine**

```bash
git add src/engine/investmentPerformance.ts src/engine/investmentPerformance.test.ts
git commit -m "feat: calculate cash-flow-adjusted investment performance"
```

### Task 3: Daily valuation capture service

**Files:**
- Create: `src/lib/domain/investments/captureInvestmentSnapshots.ts`
- Create: `src/lib/domain/investments/captureInvestmentSnapshots.test.ts`

**Interfaces:**
- Consumes: Prisma snapshot models from Task 1 and valuation helpers in `src/engine/balance.ts` and `src/engine/fx.ts`.
- Produces: `captureInvestmentSnapshots(prisma, userId, options?): Promise<CaptureOutcome>`.
- Produces: `recomputeSnapshotFlows(prisma, accountId, from): Promise<void>`.

- [ ] **Step 1: Write failing tests for complete, partial, cash-only, and same-day rerun behavior**

Mock only the Prisma methods the service consumes. Assert:

- Complete holdings with known currency and FX write a complete account row and position rows.
- A missing price currency or stale/unavailable price writes `PARTIAL`.
- A cash-only account can be complete.
- Same-day capture uses account `upsert`, replaces that day's position children, and does not duplicate history.
- A thrown account valuation is counted as failed while later accounts still run.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npm test -- src/lib/domain/investments/captureInvestmentSnapshots.test.ts`

Expected: FAIL because the capture module does not exist.

- [ ] **Step 3: Implement UTC-day normalization and capture contracts**

```ts
export type CaptureOutcome = {
  accounts: number;
  complete: number;
  partial: number;
  failed: number;
  failures: Array<{ accountId: string; reason: string }>;
};

export type CaptureOptions = {
  asOf?: Date;
  displayCurrency?: Currency;
  accountId?: string;
  validatedHoldingIds?: readonly string[];
};

export async function captureInvestmentSnapshots(
  prisma: PrismaClient,
  userId: string,
  options: CaptureOptions = {},
): Promise<CaptureOutcome>;
```

Use one Prisma transaction per account. Replace only the current day's position children. A failure must leave older snapshots untouched.

- [ ] **Step 4: Implement complete/partial classification**

Complete requires:

- `accountBalanceWithCurrency` succeeds.
- `holdingsValuation.complete` is true.
- `assumedCurrency` is empty.
- Every holding has a provable `priceCurrency`.
- Every holding was validated in this refresh against MarketLens' `expectedSession`.
- No holding has `priceStatus === "STALE"` or `"UNAVAILABLE"`.
- CAD conversion succeeds with an FX rate whose date is recorded.

Partial rows preserve diagnostic counts and position inputs but are not returned as performance points.

- [ ] **Step 5: Implement and test flow recomputation**

For each snapshot on or after `from`, sum `CONTRIBUTION` minus `WITHDRAWAL` since the previous complete snapshot through the snapshot day. Partial rows do not advance the previous-complete cursor. Convert the flow using that snapshot's recorded FX rate and update both native and display flow columns.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- src/lib/domain/investments/captureInvestmentSnapshots.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the capture service**

```bash
git add src/lib/domain/investments/captureInvestmentSnapshots.ts src/lib/domain/investments/captureInvestmentSnapshots.test.ts
git commit -m "feat: capture daily investment valuations"
```

### Task 4: Wire capture into refresh and transaction paths

**Files:**
- Modify: `src/app/api/cron/prices/route.ts`
- Modify: `src/app/actions/refresh.ts`
- Modify: `src/app/investments/actions.ts`
- Modify: `src/app/investments/import/actions.ts`
- Modify: `src/app/investments/[id]/csv/actions.ts`
- Modify: `src/lib/domain/investments/refreshHoldingPrices.test.ts` or create route-level tests following current conventions
- Modify: `src/app/investments/actions.test.ts`

**Interfaces:**
- Consumes: capture functions from Task 3.
- Produces: nightly and manual snapshots plus flow correction after ledger mutations.

- [ ] **Step 1: Write failing cron tests**

Assert that the cron selects users with any financial account, skips quote refresh for cash-only users, calls capture after each user's quote attempt, continues after one user fails, and returns:

```ts
{
  ok: true,
  users: number,
  usersRefreshed: number,
  updated: number,
  snapshots: { complete: number, partial: number, failed: number }
}
```

A run with accounts but no snapshot attempt succeeding returns a non-2xx response.

- [ ] **Step 2: Run focused tests and confirm failure**

Run the new cron test file plus `npm test -- src/app/investments/actions.test.ts`.

- [ ] **Step 3: Integrate capture into nightly and manual refresh**

Call `captureInvestmentSnapshots` after the quote attempt, including when a user has only cash accounts. Manual account refresh captures the owning user's daily valuation before redirecting.

- [ ] **Step 4: Recompute flows after ledger changes**

After transaction create/update/delete and CSV/JSON import, call `recomputeSnapshotFlows` with the earliest affected transaction date. Recompute only the affected account. Fail the mutation if recomputation fails so the ledger and cached performance cannot diverge silently.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- src/app/investments/actions.test.ts src/lib/domain/investments/captureInvestmentSnapshots.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit orchestration**

```bash
git add src/app/api/cron/prices/route.ts src/app/actions/refresh.ts src/app/investments/actions.ts src/app/investments/import/actions.ts 'src/app/investments/[id]/csv/actions.ts' src/app/investments/actions.test.ts
git commit -m "feat: record investment performance after refresh"
```

### Task 5: Performance read model for the page

**Files:**
- Create: `src/lib/domain/investments/performanceReadModel.ts`
- Create: `src/lib/domain/investments/performanceReadModel.test.ts`

**Interfaces:**
- Consumes: pure performance engine from Task 2 and persisted snapshots from Task 1.
- Produces: `buildPerformanceWorkspace(accounts, range, today): PerformanceWorkspaceView`.

- [ ] **Step 1: Write failing read-model tests**

Cover:

- No complete snapshots returns `state: "pending"`.
- One complete snapshot returns `state: "tracking"` and no return.
- Partial latest snapshot preserves the last complete headline and sets `dataHealth.needsAttention`.
- Real zero remains `state: "tracking"`; unknown current value becomes `needs-setup`.
- Range filtering changes metrics and series together.
- Movers exclude quantity-change intervals and disclose exclusions.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- src/lib/domain/investments/performanceReadModel.test.ts`

- [ ] **Step 3: Implement the serialized view contract**

```ts
export type PerformanceWorkspaceView = {
  state: "pending" | "tracking" | "incomplete";
  trackingSince: string | null;
  latestCompleteAsOf: string | null;
  portfolio: PerformanceSummary;
  accounts: Array<{
    id: string;
    name: string;
    currency: Currency;
    status: "tracking" | "needs-setup" | "incomplete";
    currentValueMinor: number | null;
    summary: PerformanceSummary;
  }>;
  movers: PositionContribution[];
  dataHealth: { needsAttention: boolean; partialAccounts: string[] };
};
```

Keep this module free of React. Prisma-shaped inputs are plain objects so tests do not require a database.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/lib/domain/investments/performanceReadModel.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the read model**

```bash
git add src/lib/domain/investments/performanceReadModel.ts src/lib/domain/investments/performanceReadModel.test.ts
git commit -m "feat: build investment performance view model"
```

### Task 6: Interactive performance workspace and honest account list

**Files:**
- Create: `src/components/investments/performance-workspace.tsx`
- Create: `src/components/investments/performance-sparkline.tsx`
- Create: `src/components/investments/performance-format.ts`
- Create: `src/components/investments/performance-format.test.ts`
- Modify: `src/app/investments/page.tsx`
- Modify: `src/app/investments/[id]/page.tsx`
- Delete: `src/components/holding-sparkline.tsx`

**Interfaces:**
- Consumes: `PerformanceWorkspaceView` from Task 5.
- Produces: accessible range/account selection, chart, contribution line, flow markers, movers, and snapshot-backed account sparklines.

- [ ] **Step 1: Read the relevant Next.js 16 documentation**

Read the App Router server/client component and data-fetching guides under `node_modules/next/dist/docs/01-app/` before editing. Record any breaking convention that affects async page props, client boundaries, or caching in the task notes.

- [ ] **Step 2: Write failing formatter tests**

Test signed currency and percent output, including positive, negative, zero, and null:

```ts
expect(formatSignedMinor(12345, "CAD")).toBe("+$123.45");
expect(formatSignedPercent(-0.031)).toBe("-3.1%");
expect(formatSignedPercent(null)).toBe("—");
```

- [ ] **Step 3: Implement formatters and run tests**

Run: `npm test -- src/components/investments/performance-format.test.ts`

Expected: PASS.

- [ ] **Step 4: Build the client workspace**

Use Recharts `ResponsiveContainer`, `AreaChart`, `Area`, `XAxis`, `YAxis`, `Tooltip`, and `ReferenceDot`. Keep one dominant interactive surface. Add `1M`, `3M`, `YTD`, `1Y`, and `All` buttons and a portfolio/account selector. The selected range filters the displayed series and all adjacent metrics together.

Render:

- Portfolio value as the dominant line/area.
- Net invested as a quiet dashed comparison line.
- Contribution/withdrawal dots with accessible text in the tooltip.
- `What moved` with contributor/detractor values and `Position changed` disclosure.
- A visually hidden summary plus a collapsible table of date, value, net invested, and return.

- [ ] **Step 5: Recompose the server page**

Load accounts, snapshots with position children, transactions, and FX in user-scoped queries. Build the read model server-side and pass only serialized values to the client component.

Replace the current total banner with the performance workspace. Keep `Add account` primary and `Import` secondary. Remove the top-level `Market data keys` action; show `Data health` only when the view model requests attention.

Account rows show real snapshot sparklines and selected-period gain/TWR. If no holdings, transactions, or balance snapshot exist, render `Needs setup` instead of `$0.00`.

- [ ] **Step 6: Remove synthetic holding history**

Delete the fake four-point `HoldingSparkline` render from the account detail page and delete the unused component. Do not replace it with book-cost interpolation.

- [ ] **Step 7: Run focused tests and type/lint checks**

Run:

```bash
npm test -- src/components/investments/performance-format.test.ts src/engine/investmentPerformance.test.ts src/lib/domain/investments/performanceReadModel.test.ts
npx eslint src/app/investments/page.tsx 'src/app/investments/[id]/page.tsx' src/components/investments
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 8: Commit the investments UX**

```bash
git add src/app/investments/page.tsx 'src/app/investments/[id]/page.tsx' src/components/investments src/components/holding-sparkline.tsx
git commit -m "feat: add honest investment performance workspace"
```

### Task 7: End-to-end states and visual verification

**Files:**
- Modify: `e2e/investments.spec.ts`
- Modify or create test helpers only if the existing session fixture cannot seed performance snapshots.

**Interfaces:**
- Verifies all tasks as one user-visible workflow.

- [ ] **Step 1: Add end-to-end coverage**

Seed or create snapshots that prove:

- A contribution changes net invested without being counted as investment gain.
- Two complete days show TWR and a real chart.
- A partial latest day shows data health while retaining the last complete value.
- An empty account shows `Needs setup`, while a provable zero shows `$0.00`.
- Range and account controls are keyboard operable.

- [ ] **Step 2: Run the investments E2E test**

Run: `npm run e2e -- e2e/investments.spec.ts`

Expected: PASS.

- [ ] **Step 3: Run the app and inspect desktop and mobile**

Start the development server, open `/investments`, and verify at desktop width and a 390px mobile viewport:

- Header/actions do not wrap awkwardly.
- Chart labels and tooltip are readable in light and dark themes.
- The primary value and performance remain above the fold.
- Account rows scan cleanly without a card mosaic.
- No synthetic sparkline remains.

- [ ] **Step 4: Fix only observed regressions and rerun focused checks**

Apply minimal fixes, then rerun the formatter, engine, read-model, and E2E tests.

- [ ] **Step 5: Commit E2E and visual fixes**

```bash
git add e2e/investments.spec.ts src/app/investments/page.tsx src/components/investments
git commit -m "test: verify investment performance experience"
```

### Task 8: Full verification and handoff

**Files:**
- Modify only files required to fix failures caused by this feature.

**Interfaces:**
- Produces a migration-valid, test-passing, lint-clean, visually verified implementation.

- [ ] **Step 1: Run database and static validation**

```bash
npx prisma validate
npx prisma generate
npx tsc --noEmit
npm run lint
```

- [ ] **Step 2: Run the full unit suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 3: Run the relevant E2E suite**

Run: `npm run e2e -- e2e/investments.spec.ts e2e/smoke.spec.ts`

Expected: all selected browser tests pass.

- [ ] **Step 4: Review the final diff**

Confirm:

- Only spec-approved investment performance files changed.
- No user data is sent to MarketLens.
- No historical backfill or interpolation was introduced.
- Snapshot and cron failure paths preserve last-known data.
- Migrations are additive and non-destructive.

- [ ] **Step 5: Commit any final verification fix**

Stage only the files changed by that fix and use a narrow commit message describing it. If no fix was required, do not create an empty commit.
