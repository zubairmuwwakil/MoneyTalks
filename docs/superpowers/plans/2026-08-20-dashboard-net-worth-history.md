# Dashboard Net-Worth History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's cash-snapshot sparkline with accurate, range-selectable daily net-worth history built from complete nightly account valuations.

**Architecture:** A pure domain read model converts each account's complete daily valuation into the selected display currency using point-in-time FX evidence, then aggregates only dates containing every account active on that date. A focused client component owns range selection, change summary, tooltip, and accessible data states while the server page continues to own database access and the live headline.

**Tech Stack:** Next.js 16 App Router, React 19 Server/Client Components, TypeScript, Prisma, Recharts, Vitest, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-08-20-dashboard-net-worth-history-design.md`

## Global Constraints

- Keep true investment performance exclusively on `/investments`.
- Include deposits and withdrawals in net-worth change.
- Use only complete nightly valuations; do not blend legacy cash-only snapshots into total-account history.
- Do not add a migration, cron job, or dependency.
- Follow the repository's Next.js 16 documentation in `node_modules/next/dist/docs/`.

---

### Task 1: Net-worth history read model

**Files:**
- Create: `src/lib/domain/net-worth/netWorthHistory.ts`
- Create: `src/lib/domain/net-worth/netWorthHistory.test.ts`

**Interfaces:**
- Consumes: `convertMinor()` and `FxRateInput` from `src/engine/fx.ts`, and `Currency` from `src/engine/money.ts`.
- Produces: `buildNetWorthHistory(accounts, displayCurrency, rates, today)`, `selectNetWorthRange(points, range)`, `summarizeNetWorthRange(points)`, `NetWorthHistoryView`, and `NetWorthRange`.

- [ ] **Step 1: Write failing aggregation and range tests**

  Cover stored display totals, point-in-time native-to-display FX conversion, partial/missing account observations, a newly tracked account, 1W/1M/YTD boundaries, and zero starting value. Use literal expected daily totals and changes.

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `npm test -- src/lib/domain/net-worth/netWorthHistory.test.ts`

  Expected: FAIL because `netWorthHistory.ts` does not exist.

- [ ] **Step 3: Implement the pure read model**

  Define the input contract:

  ```ts
  export type NetWorthAccountInput = {
    id: string;
    name: string;
    hasSetupData: boolean;
    snapshots: Array<{
    asOf: string;
    capturedAt: string;
      currency: Currency;
      totalMinor: number;
      displayCurrency: Currency;
      displayTotalMinor: number;
      status: "COMPLETE" | "PARTIAL";
    }>;
  };
  ```

  Convert each complete snapshot with stored display evidence, native currency, or an indexed latest rate satisfying `rate.asOf <= snapshot.capturedAt`, in that order. Aggregate a date only when every account active by that date has a complete convertible value. Preserve accounts with historical nightly snapshots even when current setup rows are removed. Mark accounts incomplete when the latest observation is partial, lacks a convertible complete value, or predates the expected nightly capture date.

- [ ] **Step 4: Run the focused test and verify GREEN**

  Run: `npm test -- src/lib/domain/net-worth/netWorthHistory.test.ts`

  Expected: PASS with all history, range, and summary cases green.

### Task 2: Interactive net-worth history chart

**Files:**
- Create: `src/components/net-worth-history.tsx`
- Create: `src/components/net-worth-history.test.ts`
- Delete: `src/components/net-worth-sparkline.tsx`
- Delete: `src/components/net-worth-sparkline.test.ts`

**Interfaces:**
- Consumes: `NetWorthHistoryView`, `NetWorthRange`, `selectNetWorthRange()`, and `summarizeNetWorthRange()` from Task 1.
- Produces: `<NetWorthHistory view={view} currency={currency} />`.

- [ ] **Step 1: Write failing formatter and presentation-state tests**

  Test the independently derived output of signed currency, signed percentage, period labels, and the tracking/incomplete summary function used by the screen-reader status.

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `npm test -- src/components/net-worth-history.test.ts`

  Expected: FAIL because `net-worth-history.tsx` does not exist.

- [ ] **Step 3: Implement the client component**

  Render range buttons for `1W`, `1M`, `3M`, `YTD`, `1Y`, and `All`; a selected-period absolute and percentage change; an exact-date/value tooltip; a quiet area chart; a visible “through” date; pending and incomplete states; and an `sr-only` summary. Keep this inside the existing hero card without adding another card shell.

- [ ] **Step 4: Run the focused test and verify GREEN**

  Run: `npm test -- src/components/net-worth-history.test.ts`

  Expected: PASS.

### Task 3: Dashboard data wiring and final verification

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: Prisma `investmentSnapshots` nested account selection, `buildNetWorthHistory()`, and `<NetWorthHistory />`.
- Produces: a dashboard net-worth workspace whose headline remains live and whose chart is complete nightly history.

- [ ] **Step 1: Extend the authenticated dashboard query**

  Select the snapshot fields required by `NetWorthAccountInput`, map Prisma dates and currencies into the pure read model, and build the view using the already selected dashboard display currency and FX rows.

- [ ] **Step 2: Replace the legacy sparkline wiring**

  Remove `netWorthSeries`/`BalanceSnapshot` chart preparation and render `<NetWorthHistory view={history} currency={display} />` in the existing net-worth card.

- [ ] **Step 3: Run focused and full verification**

  Run:

  ```bash
  npm test -- src/lib/domain/net-worth/netWorthHistory.test.ts src/components/net-worth-history.test.ts
  npm test
  npx eslint src/app/page.tsx src/components/net-worth-history.tsx src/components/net-worth-history.test.ts src/lib/domain/net-worth/netWorthHistory.ts src/lib/domain/net-worth/netWorthHistory.test.ts
  npx tsc --noEmit
  npm run build
  ```

  Expected: every command exits 0; the full Vitest suite reports zero failures; lint and TypeScript report no errors; the production build succeeds.
