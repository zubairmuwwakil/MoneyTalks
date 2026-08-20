# Financial Impact Visuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add honest, decision-oriented impact visuals to Purchases, Cards, and Bills.

**Architecture:** Pure domain builders convert user records into small serializable view models. Existing server pages own database access, while narrow client components own only range selection and Recharts rendering.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript, Prisma, Recharts 3, Tailwind CSS 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-20-financial-impact-visuals-design.md`

## Global Constraints

- Keep database access in Server Components and pass serializable aggregates across each client boundary.
- Use integer minor units for every calculation and CAD as the display currency.
- Exclude and disclose unconvertible amounts; never sum unlike currencies at face value.
- Say `tracked purchases`, distinguish estimated variable bills, and count only redeemed card credits as realized.
- Keep one dominant impact workspace per page; do not add dashboard-card mosaics or pie charts.

---

### Task 1: Purchase impact model and workspace

**Files:**
- Create: `src/lib/domain/purchases/purchaseImpact.ts`
- Create: `src/lib/domain/purchases/purchaseImpact.test.ts`
- Create: `src/components/purchases/purchase-impact-workspace.tsx`
- Modify: `src/app/purchases/page.tsx`

**Interfaces:**
- Consumes: `FxRateInput[]` and normalized `{ date, merchant, totalMinor, currency, refundMinor }` purchase rows.
- Produces: `buildPurchaseImpact(input, rates, asOf): PurchaseImpactView` with `4W`, `12W`, and `52W` range summaries.

- [ ] **Step 1: Write failing view-model tests**

```ts
expect(buildPurchaseImpact(rows, rates, "2026-08-20").ranges["4W"]).toMatchObject({
  totalMinor: 40_000,
  previousMinor: 20_000,
  deltaPct: 100,
});
expect(view.excludedCount).toBe(1);
```

- [ ] **Step 2: Run the tests and verify missing-module failure**

Run: `npx vitest run src/lib/domain/purchases/purchaseImpact.test.ts`

- [ ] **Step 3: Implement the pure builder**

Create Monday-aligned weekly buckets for the last 104 weeks, convert supported
currencies with `convertMinor`, aggregate received refunds as negative chart
values, derive prior-period comparisons, and rank merchant drivers.

- [ ] **Step 4: Run the focused tests to green**

Run: `npx vitest run src/lib/domain/purchases/purchaseImpact.test.ts`

- [ ] **Step 5: Add the client workspace and wire the server page**

Use a Recharts bar chart with 4W/12W/52W controls and a compact drivers column.
Replace the current four KPI cards. Query FX rates and normalize purchase dates
before invoking the builder.

- [ ] **Step 6: Verify purchase tests and type/lint coverage**

Run: `npx vitest run src/lib/domain/purchases/purchaseImpact.test.ts && npx eslint src/lib/domain/purchases/purchaseImpact.ts src/lib/domain/purchases/purchaseImpact.test.ts src/components/purchases/purchase-impact-workspace.tsx src/app/purchases/page.tsx`

### Task 2: Wallet break-even model and workspace

**Files:**
- Create: `src/lib/domain/cards/walletImpact.ts`
- Create: `src/lib/domain/cards/walletImpact.test.ts`
- Create: `src/components/cards/wallet-impact-workspace.tsx`
- Modify: `src/app/cards/page.tsx`
- Modify: `src/components/cards/wallet-client.tsx`
- Delete: `src/components/cards/wallet-summary-bar.tsx`

**Interfaces:**
- Consumes: card identity, effective fee inputs, catalogue credits, redeemed credit period keys, and recorded rewards estimate.
- Produces: `buildWalletImpact(cards, year): WalletImpactView` with per-card fee, realized value, gap, progress, and portfolio totals.

- [ ] **Step 1: Write failing realized-value and break-even tests**

```ts
expect(view.rows[0]).toMatchObject({ realizedMinor: 24_000, feeMinor: 15_500, netMinor: 8_500, status: "ahead" });
expect(view.aheadCount).toBe(1);
```

- [ ] **Step 2: Run the tests and verify missing-module failure**

Run: `npx vitest run src/lib/domain/cards/walletImpact.test.ts`

- [ ] **Step 3: Implement the pure builder**

Deduplicate redemptions by credit/period, include only the selected year, add
the manual rewards estimate, subtract the effective annual fee, and produce a
safe 0..100 visual progress with explicit no-fee handling.

- [ ] **Step 4: Run the focused tests to green**

Run: `npx vitest run src/lib/domain/cards/walletImpact.test.ts`

- [ ] **Step 5: Replace the KPI grid with the break-even workspace**

Keep renewal actions and missing-date warnings in `WalletClient`. Render
accessible CSS bullet rows with recorded value, fee marker, signed gap, and a
link to each card detail page.

- [ ] **Step 6: Verify card tests and lint coverage**

Run: `npx vitest run src/lib/domain/cards/walletImpact.test.ts && npx eslint src/lib/domain/cards/walletImpact.ts src/lib/domain/cards/walletImpact.test.ts src/components/cards/wallet-impact-workspace.tsx src/components/cards/wallet-client.tsx src/app/cards/page.tsx`

### Task 3: Bill runway model and workspace

**Files:**
- Create: `src/lib/domain/bills/billImpact.ts`
- Create: `src/lib/domain/bills/billImpact.test.ts`
- Create: `src/components/bills/bill-impact-workspace.tsx`
- Modify: `src/app/bills/page.tsx`

**Interfaces:**
- Consumes: `BillDef[]`, `FxRateInput[]`, and an ISO start date.
- Produces: `buildBillImpact(bills, rates, startDate, 8): BillImpactView` with fixed/variable weekly bars, totals, average, busiest week, and exclusions.

- [ ] **Step 1: Write failing FX, variable split, and busiest-week tests**

```ts
expect(view.weeks[0]).toMatchObject({ fixedMinor: 10_000, variableMinor: 5_000 });
expect(view.busiestWeek?.totalMinor).toBe(15_000);
expect(view.excludedCount).toBe(1);
```

- [ ] **Step 2: Run the tests and verify missing-module failure**

Run: `npx vitest run src/lib/domain/bills/billImpact.test.ts`

- [ ] **Step 3: Implement the pure builder**

Generate bounded bill occurrences, convert each to CAD, align them into eight
Monday-starting weeks, split fixed from variable, and derive total, average,
busiest week, and exclusion counts.

- [ ] **Step 4: Run the focused tests to green**

Run: `npx vitest run src/lib/domain/bills/billImpact.test.ts`

- [ ] **Step 5: Add the 8-week workspace to Bills**

Use a compact stacked bar chart with variable obligations visually quieter,
link to `/bills/forecast`, and place the workspace before the categorized list.

- [ ] **Step 6: Verify bill tests and lint coverage**

Run: `npx vitest run src/lib/domain/bills/billImpact.test.ts && npx eslint src/lib/domain/bills/billImpact.ts src/lib/domain/bills/billImpact.test.ts src/components/bills/bill-impact-workspace.tsx src/app/bills/page.tsx`

### Task 4: Integrated verification and visual QA

**Files:**
- Modify only files required by failures found during verification.

**Interfaces:**
- Consumes: the three completed impact workspaces.
- Produces: a buildable, lint-clean feature with no unrelated changes.

- [ ] **Step 1: Run all unit tests**

Run: `npm test`

- [ ] **Step 2: Run the full linter**

Run: `npm run lint`

- [ ] **Step 3: Run the production build**

Run: `npm run build`

- [ ] **Step 4: Inspect the diff and requirements**

Run: `git diff --check && git status --short && git diff --stat`

- [ ] **Step 5: Perform browser QA when local authenticated data is available**

Run the app and inspect `/purchases`, `/cards`, and `/bills` at desktop and
mobile widths. Verify empty states, tooltips, data notes, links, and overflow.
