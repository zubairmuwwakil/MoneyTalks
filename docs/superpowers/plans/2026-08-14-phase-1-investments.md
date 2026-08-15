# MoneyTalks Phase 1 (Investments) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Working investments module — accounts, holdings, transactions, and balance snapshots with full CRUD, a net worth dashboard with CAD/USD/JMD toggle and snapshot sparkline, and an authenticated JSON import so the owner's real data enters at runtime (never through the repo).

**Architecture:** Pure engine functions (`src/engine/`) compute balances (latest snapshot wins over transaction-derived), FX conversion (direct rate, then inverse fallback), net worth aggregation, and the daily net-worth series. Server actions handle mutations (auth-checked, Zod-validated, thin Prisma calls); GET API routes exist for programmatic access and auth-boundary tests. Server components render everything; the only client components are the sparkline (Recharts) and nav.

**Tech Stack:** Adds to Phase 0: `zod`, `recharts`, `dotenv` (dev). Everything else unchanged.

**Spec:** `docs/superpowers/specs/2026-08-14-moneytalks-design.md`

**Prerequisite:** Phase 0 complete and verified (login works, `requireUser` exists, auth schema migrated, Playwright smoke green).

## Global Constraints

All Phase 0 Global Constraints apply verbatim (public repo — zero personal data anywhere, including test fixtures, which must be obviously fictional; integer minor units; pure engines; strict TS; 401 for unauthenticated APIs; commit trailer; OWNER CHECKPOINT protocol). Phase-1 additions:

- The financial account model is `FinancialAccount` (`Account` belongs to the Auth.js adapter).
- Every financial row is scoped by `userId`; every query filters on it. No cross-user access paths, even though there is one user today.
- Amount columns are Prisma `Int` (minor units). This caps a single stored amount at ±$21.4M — fine for personal scale; revisit as `BigInt` only if it ever matters. `Holding.quantity` is Prisma `Decimal` (crypto needs fractional units); convert with `Number()` at the engine boundary.
- Engine functions never call `Date.now()` / `new Date()` without arguments — "now" is always a parameter. This keeps them pure and testable.
- v1 simplification (documented here, revisit in Phase 5): historical points in the net-worth series are converted at the *latest* FX rates, not historical ones.

---

### Task 1: Financial data models + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration via CLI

**Interfaces:**
- Produces: Prisma models `FinancialAccount`, `Holding`, `Transaction`, `BalanceSnapshot`, `FxRate`; enums `AccountType`, `TxType`. All later tasks query these through the `prisma` singleton from `@/lib/prisma`.

- [x] **Step 1: Extend the schema**

Append to `prisma/schema.prisma` (and add the back-relation `financialAccounts FinancialAccount[]` plus `fxRates FxRate[]` to the existing `User` model):

```prisma
// ---- Financial domain (Phase 1) ----

enum AccountType {
  RRSP
  TFSA
  RDSP
  FHSA
  ROTH_IRA
  NON_REGISTERED
  CASH
  CHEQUING
  CRYPTO
}

enum TxType {
  CONTRIBUTION
  WITHDRAWAL
  BUY
  SELL
  DIVIDEND
  INTEREST
  FEE
}

model FinancialAccount {
  id           String            @id @default(cuid())
  userId       String
  user         User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  type         AccountType
  name         String
  institution  String
  country      String // ISO-3166 alpha-2
  currency     String // ISO-4217: CAD | USD | JMD
  isUSSitus    Boolean           @default(false)
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt
  holdings     Holding[]
  transactions Transaction[]
  snapshots    BalanceSnapshot[]

  @@index([userId])
}

model Holding {
  id              String           @id @default(cuid())
  accountId       String
  account         FinancialAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  symbol          String
  name            String
  domicileCountry String // ISO-3166 alpha-2 — drives the PFIC scan in Phase 2
  quantity        Decimal
  bookCostMinor   Int?
  lastPriceMinor  Int
  priceAsOf       DateTime

  @@unique([accountId, symbol])
}

model Transaction {
  id          String           @id @default(cuid())
  accountId   String
  account     FinancialAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  type        TxType
  amountMinor Int // always positive; TxType determines the sign in derivation
  currency    String
  date        DateTime
  description String?
  dedupeHash  String?

  @@index([accountId, date])
}

model BalanceSnapshot {
  id           String           @id @default(cuid())
  accountId    String
  account      FinancialAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  balanceMinor Int
  currency     String
  asOf         DateTime

  @@unique([accountId, asOf])
  @@index([accountId, asOf])
}

model FxRate {
  id     String   @id @default(cuid())
  userId String
  user   User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  base   String // ISO-4217
  quote  String // ISO-4217
  rate   Decimal
  asOf   DateTime

  @@unique([userId, base, quote, asOf])
}
```

- [x] **Step 2: Migrate and verify**

```bash
npx dotenv -e .env.local -- npx prisma migrate dev --name financial-models
npx dotenv -e .env.local -- npx prisma migrate status
```

Expected: migration applied; `Database schema is up to date!`. Then `npm run build` to confirm the generated client compiles with strict TS.

- [x] **Step 3: Commit**

```bash
git add prisma/
git commit -m "feat: add financial domain models (accounts, holdings, transactions, snapshots, fx)"
```

---

### Task 2: Engine — currency conversion

**Files:**
- Create: `src/engine/fx.ts`, `src/engine/fx.test.ts`

**Interfaces:**
- Consumes: `Currency` from `@/engine/money` (Task 2 of Phase 0).
- Produces:
  - `interface FxRateInput { base: Currency; quote: Currency; rate: number; asOf: string }`
  - `convertMinor(amountMinor: number, from: Currency, to: Currency, rates: FxRateInput[]): number`
  - `class MissingFxRateError extends Error` (UI catches it to prompt for a rate)

- [x] **Step 1: Write the failing test**

Create `src/engine/fx.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { convertMinor, MissingFxRateError, type FxRateInput } from "./fx";

const rates: FxRateInput[] = [
  { base: "USD", quote: "CAD", rate: 1.35, asOf: "2026-01-01" },
  { base: "USD", quote: "CAD", rate: 1.4, asOf: "2026-08-01" }, // latest wins
  { base: "JMD", quote: "CAD", rate: 0.009, asOf: "2026-08-01" },
];

describe("convertMinor", () => {
  it("returns the amount unchanged for same-currency", () => {
    expect(convertMinor(1000, "CAD", "CAD", [])).toBe(1000);
  });

  it("uses the latest direct rate", () => {
    expect(convertMinor(10000, "USD", "CAD", rates)).toBe(14000); // 1.40, not 1.35
  });

  it("falls back to the inverse rate", () => {
    expect(convertMinor(14000, "CAD", "USD", rates)).toBe(10000); // 14000 / 1.40
  });

  it("rounds to integer minor units", () => {
    expect(convertMinor(999, "USD", "CAD", rates)).toBe(1399); // 999 * 1.4 = 1398.6
  });

  it("throws MissingFxRateError when no path exists", () => {
    expect(() => convertMinor(1000, "USD", "JMD", rates)).toThrow(MissingFxRateError);
  });

  it("rejects non-integer amounts", () => {
    expect(() => convertMinor(10.5, "USD", "CAD", rates)).toThrow(RangeError);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `./fx`.

- [x] **Step 3: Implement**

Create `src/engine/fx.ts`:

```ts
import type { Currency } from "./money";

export interface FxRateInput {
  base: Currency;
  quote: Currency;
  rate: number;
  asOf: string; // ISO 8601
}

export class MissingFxRateError extends Error {
  constructor(from: Currency, to: Currency) {
    super(`No FX rate available to convert ${from} to ${to}`);
    this.name = "MissingFxRateError";
  }
}

function latest(rates: FxRateInput[], base: Currency, quote: Currency): FxRateInput | undefined {
  return rates
    .filter((r) => r.base === base && r.quote === quote)
    .sort((a, b) => (a.asOf < b.asOf ? 1 : -1))[0];
}

export function convertMinor(
  amountMinor: number,
  from: Currency,
  to: Currency,
  rates: FxRateInput[],
): number {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(`amountMinor must be a safe integer, got ${amountMinor}`);
  }
  if (from === to) return amountMinor;

  const direct = latest(rates, from, to);
  if (direct) return Math.round(amountMinor * direct.rate);

  const inverse = latest(rates, to, from);
  if (inverse) return Math.round(amountMinor / inverse.rate);

  throw new MissingFxRateError(from, to);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all pass.

- [x] **Step 5: Commit**

```bash
git add src/engine/fx.ts src/engine/fx.test.ts
git commit -m "feat: add FX conversion engine with inverse fallback"
```

---

### Task 3: Engine — account balances and holding values

**Files:**
- Create: `src/engine/balance.ts`, `src/engine/balance.test.ts`

**Interfaces:**
- Produces:
  - `type TxTypeName = "CONTRIBUTION" | "WITHDRAWAL" | "BUY" | "SELL" | "DIVIDEND" | "INTEREST" | "FEE"`
  - `interface TxInput { type: TxTypeName; amountMinor: number; date: string }`
  - `interface SnapshotInput { balanceMinor: number; asOf: string }`
  - `deriveBalanceMinor(transactions: TxInput[]): number`
  - `accountBalance(transactions: TxInput[], snapshots: SnapshotInput[]): { balanceMinor: number; asOf: string | null; source: "snapshot" | "derived" }`
  - `holdingValueMinor(quantity: number, lastPriceMinor: number): number`

**Sign conventions (the spec's "balances derive from transactions"):** CONTRIBUTION, DIVIDEND, INTEREST add; WITHDRAWAL, FEE subtract; BUY and SELL are internal asset swaps within the account and contribute zero. **Snapshot precedence (per spec):** the latest snapshot wins outright over the derived number, even if a transaction is dated after it — v1 rule, documented.

- [x] **Step 1: Write the failing test**

Create `src/engine/balance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  accountBalance,
  deriveBalanceMinor,
  holdingValueMinor,
  type SnapshotInput,
  type TxInput,
} from "./balance";

const txs: TxInput[] = [
  { type: "CONTRIBUTION", amountMinor: 100_000, date: "2026-01-10" },
  { type: "DIVIDEND", amountMinor: 5_000, date: "2026-02-01" },
  { type: "INTEREST", amountMinor: 1_000, date: "2026-02-15" },
  { type: "WITHDRAWAL", amountMinor: 20_000, date: "2026-03-01" },
  { type: "FEE", amountMinor: 500, date: "2026-03-02" },
  { type: "BUY", amountMinor: 50_000, date: "2026-03-10" }, // no balance effect
  { type: "SELL", amountMinor: 10_000, date: "2026-03-20" }, // no balance effect
];

describe("deriveBalanceMinor", () => {
  it("applies sign conventions", () => {
    expect(deriveBalanceMinor(txs)).toBe(85_500); // 100000+5000+1000-20000-500
  });

  it("is zero with no transactions", () => {
    expect(deriveBalanceMinor([])).toBe(0);
  });
});

describe("accountBalance", () => {
  const snaps: SnapshotInput[] = [
    { balanceMinor: 90_000, asOf: "2026-02-20" },
    { balanceMinor: 95_000, asOf: "2026-03-15" },
  ];

  it("prefers the latest snapshot when snapshots exist", () => {
    expect(accountBalance(txs, snaps)).toEqual({
      balanceMinor: 95_000,
      asOf: "2026-03-15",
      source: "snapshot",
    });
  });

  it("derives from transactions when there are no snapshots", () => {
    expect(accountBalance(txs, [])).toEqual({
      balanceMinor: 85_500,
      asOf: "2026-03-20",
      source: "derived",
    });
  });

  it("returns zero derived balance with no data at all", () => {
    expect(accountBalance([], [])).toEqual({
      balanceMinor: 0,
      asOf: null,
      source: "derived",
    });
  });
});

describe("holdingValueMinor", () => {
  it("multiplies quantity by price and rounds", () => {
    expect(holdingValueMinor(10, 12345)).toBe(123450);
    expect(holdingValueMinor(0.5, 33333)).toBe(16667); // 16666.5 rounds up
  });

  it("handles fractional crypto quantities", () => {
    expect(holdingValueMinor(0.0042, 10_000_000_00)).toBe(4_200_000); // 0.0042 BTC × $10M... fictional
  });

  it("rejects non-finite quantity and non-integer price", () => {
    expect(() => holdingValueMinor(NaN, 100)).toThrow(RangeError);
    expect(() => holdingValueMinor(1, 10.5)).toThrow(RangeError);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `./balance`.

- [x] **Step 3: Implement**

Create `src/engine/balance.ts`:

```ts
export type TxTypeName =
  | "CONTRIBUTION"
  | "WITHDRAWAL"
  | "BUY"
  | "SELL"
  | "DIVIDEND"
  | "INTEREST"
  | "FEE";

export interface TxInput {
  type: TxTypeName;
  amountMinor: number;
  date: string; // ISO 8601
}

export interface SnapshotInput {
  balanceMinor: number;
  asOf: string; // ISO 8601
}

const SIGN: Record<TxTypeName, number> = {
  CONTRIBUTION: 1,
  DIVIDEND: 1,
  INTEREST: 1,
  WITHDRAWAL: -1,
  FEE: -1,
  BUY: 0,
  SELL: 0,
};

export function deriveBalanceMinor(transactions: TxInput[]): number {
  return transactions.reduce((sum, tx) => {
    if (!Number.isSafeInteger(tx.amountMinor)) {
      throw new RangeError(`amountMinor must be a safe integer, got ${tx.amountMinor}`);
    }
    return sum + SIGN[tx.type] * tx.amountMinor;
  }, 0);
}

export function accountBalance(
  transactions: TxInput[],
  snapshots: SnapshotInput[],
): { balanceMinor: number; asOf: string | null; source: "snapshot" | "derived" } {
  if (snapshots.length > 0) {
    const latest = [...snapshots].sort((a, b) => (a.asOf < b.asOf ? 1 : -1))[0];
    return { balanceMinor: latest.balanceMinor, asOf: latest.asOf, source: "snapshot" };
  }
  const latestTx = [...transactions].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  return {
    balanceMinor: deriveBalanceMinor(transactions),
    asOf: latestTx?.date ?? null,
    source: "derived",
  };
}

export function holdingValueMinor(quantity: number, lastPriceMinor: number): number {
  if (!Number.isFinite(quantity)) {
    throw new RangeError(`quantity must be finite, got ${quantity}`);
  }
  if (!Number.isSafeInteger(lastPriceMinor)) {
    throw new RangeError(`lastPriceMinor must be a safe integer, got ${lastPriceMinor}`);
  }
  return Math.round(quantity * lastPriceMinor);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all pass.

- [x] **Step 5: Commit**

```bash
git add src/engine/balance.ts src/engine/balance.test.ts
git commit -m "feat: add balance engine (snapshot precedence, sign conventions, holding values)"
```

---

### Task 4: Engine — net worth aggregation and daily series

**Files:**
- Create: `src/engine/networth.ts`, `src/engine/networth.test.ts`

**Interfaces:**
- Consumes: `convertMinor`, `FxRateInput` from `./fx`; `Currency` from `./money`.
- Produces:
  - `interface AccountBalanceRow { id: string; name: string; type: string; currency: Currency; balanceMinor: number }`
  - `netWorth(rows: AccountBalanceRow[], display: Currency, rates: FxRateInput[]): { totalMinor: number; perAccount: Array<AccountBalanceRow & { displayMinor: number }> }`
  - `interface SnapshotRow { accountId: string; balanceMinor: number; currency: Currency; asOf: string }`
  - `netWorthSeries(snapshots: SnapshotRow[], display: Currency, rates: FxRateInput[], fromDate: string, toDate: string): Array<{ date: string; totalMinor: number }>` — daily points, per-account forward-fill of the latest snapshot on or before each day; accounts with no snapshot yet contribute 0; dates are `YYYY-MM-DD`.

- [x] **Step 1: Write the failing test**

Create `src/engine/networth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { FxRateInput } from "./fx";
import { netWorth, netWorthSeries, type AccountBalanceRow, type SnapshotRow } from "./networth";

const rates: FxRateInput[] = [{ base: "USD", quote: "CAD", rate: 1.4, asOf: "2026-08-01" }];

describe("netWorth", () => {
  const rows: AccountBalanceRow[] = [
    { id: "a1", name: "Maple RRSP", type: "RRSP", currency: "CAD", balanceMinor: 500_000 },
    { id: "a2", name: "Eagle Roth", type: "ROTH_IRA", currency: "USD", balanceMinor: 100_000 },
  ];

  it("converts every account into the display currency and totals", () => {
    const result = netWorth(rows, "CAD", rates);
    expect(result.totalMinor).toBe(640_000); // 500000 + 100000*1.4
    expect(result.perAccount[0].displayMinor).toBe(500_000);
    expect(result.perAccount[1].displayMinor).toBe(140_000);
  });

  it("works in the other direction via inverse", () => {
    const result = netWorth(rows, "USD", rates);
    expect(result.totalMinor).toBe(457_143); // round(500000/1.4)=357143 + 100000
  });

  it("handles an empty account list", () => {
    expect(netWorth([], "CAD", rates).totalMinor).toBe(0);
  });
});

describe("netWorthSeries", () => {
  const snaps: SnapshotRow[] = [
    { accountId: "a1", balanceMinor: 100_000, currency: "CAD", asOf: "2026-08-01" },
    { accountId: "a1", balanceMinor: 120_000, currency: "CAD", asOf: "2026-08-03" },
    { accountId: "a2", balanceMinor: 50_000, currency: "USD", asOf: "2026-08-02" },
  ];

  it("forward-fills each account and sums per day", () => {
    const series = netWorthSeries(snaps, "CAD", rates, "2026-08-01", "2026-08-04");
    expect(series).toEqual([
      { date: "2026-08-01", totalMinor: 100_000 }, // a1 only
      { date: "2026-08-02", totalMinor: 170_000 }, // a1 100000 + a2 50000*1.4
      { date: "2026-08-03", totalMinor: 190_000 }, // a1 updated to 120000
      { date: "2026-08-04", totalMinor: 190_000 }, // forward-filled
    ]);
  });

  it("returns an empty array when fromDate is after toDate", () => {
    expect(netWorthSeries(snaps, "CAD", rates, "2026-08-05", "2026-08-01")).toEqual([]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `./networth`.

- [x] **Step 3: Implement**

Create `src/engine/networth.ts`:

```ts
import { convertMinor, type FxRateInput } from "./fx";
import type { Currency } from "./money";

export interface AccountBalanceRow {
  id: string;
  name: string;
  type: string;
  currency: Currency;
  balanceMinor: number;
}

export function netWorth(
  rows: AccountBalanceRow[],
  display: Currency,
  rates: FxRateInput[],
): { totalMinor: number; perAccount: Array<AccountBalanceRow & { displayMinor: number }> } {
  const perAccount = rows.map((row) => ({
    ...row,
    displayMinor: convertMinor(row.balanceMinor, row.currency, display, rates),
  }));
  return {
    totalMinor: perAccount.reduce((sum, r) => sum + r.displayMinor, 0),
    perAccount,
  };
}

export interface SnapshotRow {
  accountId: string;
  balanceMinor: number;
  currency: Currency;
  asOf: string; // ISO 8601
}

function toUtcDay(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function dayToIso(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

const DAY_MS = 86_400_000;

export function netWorthSeries(
  snapshots: SnapshotRow[],
  display: Currency,
  rates: FxRateInput[],
  fromDate: string,
  toDate: string,
): Array<{ date: string; totalMinor: number }> {
  const from = toUtcDay(fromDate);
  const to = toUtcDay(toDate);
  if (from > to) return [];

  const byAccount = new Map<string, SnapshotRow[]>();
  for (const snap of snapshots) {
    const list = byAccount.get(snap.accountId) ?? [];
    list.push(snap);
    byAccount.set(snap.accountId, list);
  }
  for (const list of byAccount.values()) {
    list.sort((a, b) => (a.asOf < b.asOf ? -1 : 1));
  }

  const series: Array<{ date: string; totalMinor: number }> = [];
  for (let day = from; day <= to; day += DAY_MS) {
    const date = dayToIso(day);
    let totalMinor = 0;
    for (const list of byAccount.values()) {
      let current: SnapshotRow | undefined;
      for (const snap of list) {
        if (toUtcDay(snap.asOf) <= day) current = snap;
        else break;
      }
      if (current) {
        totalMinor += convertMinor(current.balanceMinor, current.currency, display, rates);
      }
    }
    series.push({ date, totalMinor });
  }
  return series;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all pass.

- [x] **Step 5: Commit**

```bash
git add src/engine/networth.ts src/engine/networth.test.ts
git commit -m "feat: add net worth aggregation and daily series engine"
```

---

### Task 5: Validation schemas, auth-scoped data helpers, server actions, GET APIs

**Files:**
- Create: `src/lib/validation/investments.ts`, `src/lib/validation/investments.test.ts`, `src/app/investments/actions.ts`, `src/app/api/accounts/route.ts`, `src/app/api/accounts/[id]/route.ts`
- Modify: `src/lib/require-user.ts`

**Interfaces:**
- Consumes: `prisma`, `auth`, `requireUser` from Phase 0.
- Produces:
  - `requireUserId(): Promise<string>` (added to `src/lib/require-user.ts`) — session → `User.id`, redirects to `/login` if absent.
  - `getSessionUserId(): Promise<string | null>` — non-redirecting variant for API routes.
  - Zod schemas: `accountInput`, `holdingInput`, `transactionInput`, `snapshotInput`, `fxRateInput`, `importFile` (exported with inferred types).
  - Server actions: `createAccount`, `deleteAccount`, `addHolding`, `addTransaction`, `addSnapshot`, `addFxRate` — each takes `FormData`, returns `{ ok: true } | { ok: false; error: string }`.
  - `GET /api/accounts` (list with computed balances), `GET /api/accounts/[id]` (detail) — 401 unauthenticated.

- [x] **Step 1: Install zod and write the failing validation test**

```bash
npm install zod
```

Create `src/lib/validation/investments.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { accountInput, importFile, transactionInput } from "./investments";

describe("accountInput", () => {
  it("accepts a valid account", () => {
    const parsed = accountInput.safeParse({
      type: "RRSP",
      name: "Maple RRSP",
      institution: "Maple Invest",
      country: "CA",
      currency: "CAD",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown types and bad country codes", () => {
    expect(accountInput.safeParse({ type: "SLUSH_FUND", name: "x", institution: "y", country: "CA", currency: "CAD" }).success).toBe(false);
    expect(accountInput.safeParse({ type: "TFSA", name: "x", institution: "y", country: "Canada", currency: "CAD" }).success).toBe(false);
  });
});

describe("transactionInput", () => {
  it("coerces form-data strings and requires positive integers", () => {
    expect(transactionInput.safeParse({ type: "CONTRIBUTION", amountMinor: "5000", currency: "CAD", date: "2026-08-01" }).success).toBe(true);
    expect(transactionInput.safeParse({ type: "CONTRIBUTION", amountMinor: "-5000", currency: "CAD", date: "2026-08-01" }).success).toBe(false);
    expect(transactionInput.safeParse({ type: "CONTRIBUTION", amountMinor: "50.5", currency: "CAD", date: "2026-08-01" }).success).toBe(false);
  });
});

describe("importFile", () => {
  it("accepts a nested accounts + fxRates document", () => {
    const parsed = importFile.safeParse({
      accounts: [
        {
          type: "TFSA",
          name: "Maple TFSA",
          institution: "Maple Invest",
          country: "CA",
          currency: "CAD",
          holdings: [
            { symbol: "XEQT.TO", name: "Fictional All-Equity ETF", domicileCountry: "CA", quantity: 10, lastPriceMinor: 3000, priceAsOf: "2026-08-01" },
          ],
          snapshots: [{ balanceMinor: 30000, asOf: "2026-08-01" }],
        },
      ],
      fxRates: [{ base: "USD", quote: "CAD", rate: 1.4, asOf: "2026-08-01" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an fx rate with base === quote", () => {
    expect(importFile.safeParse({ accounts: [], fxRates: [{ base: "CAD", quote: "CAD", rate: 1, asOf: "2026-08-01" }] }).success).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `./investments`.

- [x] **Step 3: Implement the schemas**

Create `src/lib/validation/investments.ts`:

```ts
import { z } from "zod";

export const currencyCode = z.enum(["CAD", "USD", "JMD"]);
const countryCode = z.string().regex(/^[A-Z]{2}$/, "ISO-3166 alpha-2, e.g. CA");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "ISO 8601 date, e.g. 2026-08-01");
const minorUnits = z.coerce.number().int().safe();
const positiveMinor = minorUnits.positive();

export const accountInput = z.object({
  type: z.enum(["RRSP", "TFSA", "RDSP", "FHSA", "ROTH_IRA", "NON_REGISTERED", "CASH", "CHEQUING", "CRYPTO"]),
  name: z.string().trim().min(1).max(80),
  institution: z.string().trim().min(1).max(80),
  country: countryCode,
  currency: currencyCode,
  isUSSitus: z.coerce.boolean().default(false),
});

export const holdingInput = z.object({
  symbol: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(80),
  domicileCountry: countryCode,
  quantity: z.coerce.number().positive().finite(),
  bookCostMinor: minorUnits.nonnegative().optional(),
  lastPriceMinor: minorUnits.nonnegative(),
  priceAsOf: isoDate,
});

export const transactionInput = z.object({
  type: z.enum(["CONTRIBUTION", "WITHDRAWAL", "BUY", "SELL", "DIVIDEND", "INTEREST", "FEE"]),
  amountMinor: positiveMinor,
  currency: currencyCode,
  date: isoDate,
  description: z.string().trim().max(200).optional(),
});

export const snapshotInput = z.object({
  balanceMinor: minorUnits, // negatives allowed: overdrawn chequing is real
  asOf: isoDate,
});

export const fxRateInput = z
  .object({
    base: currencyCode,
    quote: currencyCode,
    rate: z.coerce.number().positive().finite(),
    asOf: isoDate,
  })
  .refine((r) => r.base !== r.quote, { message: "base and quote must differ" });

export const importFile = z.object({
  accounts: z.array(
    accountInput.extend({
      holdings: z.array(holdingInput).optional(),
      snapshots: z.array(snapshotInput).optional(),
    }),
  ),
  fxRates: z.array(fxRateInput).optional(),
});

export type AccountInput = z.infer<typeof accountInput>;
export type ImportFile = z.infer<typeof importFile>;
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all pass.

- [x] **Step 5: Add the user-id helpers**

In `src/lib/require-user.ts`, add (keeping `requireUser` as-is):

```ts
import { prisma } from "@/lib/prisma";

export async function requireUserId(): Promise<string> {
  const { email } = await requireUser();
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) redirect("/login");
  return user.id;
}

export async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return user?.id ?? null;
}
```

(Add `import { auth } from "@/auth";` to the file's imports.)

- [x] **Step 6: Implement the server actions**

Create `src/app/investments/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import {
  accountInput,
  fxRateInput,
  holdingInput,
  snapshotInput,
  transactionInput,
} from "@/lib/validation/investments";

type ActionResult = { ok: true } | { ok: false; error: string };

function fail(error: unknown): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : "Invalid input" };
}

async function ownedAccount(userId: string, accountId: string) {
  const account = await prisma.financialAccount.findFirst({
    where: { id: accountId, userId },
    select: { id: true },
  });
  if (!account) throw new Error("Account not found");
  return account;
}

export async function createAccount(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = accountInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  await prisma.financialAccount.create({ data: { ...parsed.data, userId } });
  revalidatePath("/investments");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteAccount(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  try {
    await ownedAccount(userId, id);
    await prisma.financialAccount.delete({ where: { id } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/investments");
  revalidatePath("/");
  return { ok: true };
}

export async function addHolding(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const accountId = String(formData.get("accountId") ?? "");
  const parsed = holdingInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  try {
    await ownedAccount(userId, accountId);
    await prisma.holding.upsert({
      where: { accountId_symbol: { accountId, symbol: parsed.data.symbol } },
      update: { ...parsed.data, priceAsOf: new Date(parsed.data.priceAsOf) },
      create: { ...parsed.data, accountId, priceAsOf: new Date(parsed.data.priceAsOf) },
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/investments/${accountId}`);
  return { ok: true };
}

export async function addTransaction(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const accountId = String(formData.get("accountId") ?? "");
  const parsed = transactionInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  try {
    await ownedAccount(userId, accountId);
    await prisma.transaction.create({
      data: { ...parsed.data, accountId, date: new Date(parsed.data.date) },
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/investments/${accountId}`);
  revalidatePath("/");
  return { ok: true };
}

export async function addSnapshot(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const accountId = String(formData.get("accountId") ?? "");
  const parsed = snapshotInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  try {
    const account = await prisma.financialAccount.findFirst({
      where: { id: accountId, userId },
      select: { currency: true },
    });
    if (!account) throw new Error("Account not found");
    await prisma.balanceSnapshot.upsert({
      where: { accountId_asOf: { accountId, asOf: new Date(parsed.data.asOf) } },
      update: { balanceMinor: parsed.data.balanceMinor },
      create: {
        accountId,
        balanceMinor: parsed.data.balanceMinor,
        currency: account.currency,
        asOf: new Date(parsed.data.asOf),
      },
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/investments/${accountId}`);
  revalidatePath("/");
  return { ok: true };
}

export async function addFxRate(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = fxRateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  const { base, quote, rate, asOf } = parsed.data;
  await prisma.fxRate.upsert({
    where: { userId_base_quote_asOf: { userId, base, quote, asOf: new Date(asOf) } },
    update: { rate },
    create: { userId, base, quote, rate, asOf: new Date(asOf) },
  });
  revalidatePath("/investments");
  revalidatePath("/");
  return { ok: true };
}
```

- [x] **Step 7: Implement the GET APIs**

Create `src/app/api/accounts/route.ts`:

```ts
import { accountBalance, type SnapshotInput, type TxInput } from "@/engine/balance";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const accounts = await prisma.financialAccount.findMany({
    where: { userId },
    include: { transactions: true, snapshots: true },
    orderBy: { name: "asc" },
  });

  return Response.json(
    accounts.map((a) => {
      const balance = accountBalance(
        a.transactions.map(
          (t): TxInput => ({ type: t.type, amountMinor: t.amountMinor, date: t.date.toISOString() }),
        ),
        a.snapshots.map(
          (s): SnapshotInput => ({ balanceMinor: s.balanceMinor, asOf: s.asOf.toISOString() }),
        ),
      );
      return {
        id: a.id,
        type: a.type,
        name: a.name,
        institution: a.institution,
        country: a.country,
        currency: a.currency,
        balanceMinor: balance.balanceMinor,
        balanceSource: balance.source,
        balanceAsOf: balance.asOf,
      };
    }),
  );
}
```

Create `src/app/api/accounts/[id]/route.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const account = await prisma.financialAccount.findFirst({
    where: { id, userId },
    include: { holdings: true, transactions: { orderBy: { date: "desc" } }, snapshots: { orderBy: { asOf: "desc" } } },
  });
  if (!account) return Response.json({ error: "not found" }, { status: 404 });

  return Response.json({
    ...account,
    holdings: account.holdings.map((h) => ({ ...h, quantity: Number(h.quantity) })),
  });
}
```

- [x] **Step 8: Verify build + tests, commit**

Run: `npm test && npm run lint && npm run build`
Expected: pass.

```bash
git add src/lib/ src/app/investments/actions.ts src/app/api/accounts/ package.json package-lock.json
git commit -m "feat: add investments validation, server actions, and account APIs"
```

---

### Task 6: Investments UI — account list, detail, and forms

**Files:**
- Create: `src/app/investments/new/page.tsx`, `src/app/investments/[id]/page.tsx`
- Modify: `src/app/investments/page.tsx`

**Interfaces:**
- Consumes: actions from Task 5, `accountBalance`/`holdingValueMinor` from Task 3, `formatMinorUnits` from Phase 0, `requireUserId`.
- Produces: `/investments` (list + link to add), `/investments/new` (create form), `/investments/[id]` (detail + add-holding/transaction/snapshot forms + delete).

- [x] **Step 1: Replace the placeholder list page**

Replace `src/app/investments/page.tsx` entirely with:

```tsx
import Link from "next/link";
import { accountBalance } from "@/engine/balance";
import { formatMinorUnits, type Currency } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export default async function InvestmentsPage() {
  const userId = await requireUserId();
  const accounts = await prisma.financialAccount.findMany({
    where: { userId },
    include: { transactions: true, snapshots: true },
    orderBy: { name: "asc" },
  });

  return (
    <main className="py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Investments</h1>
        <div className="flex gap-2">
          <Link href="/investments/import" className="rounded border px-3 py-1 text-sm">
            Import
          </Link>
          <Link href="/investments/new" className="rounded bg-foreground px-3 py-1 text-sm text-background">
            Add account
          </Link>
        </div>
      </div>

      {accounts.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No accounts yet. Add one or import your data.
        </p>
      ) : (
        <ul className="mt-6 divide-y rounded border">
          {accounts.map((a) => {
            const balance = accountBalance(
              a.transactions.map((t) => ({ type: t.type, amountMinor: t.amountMinor, date: t.date.toISOString() })),
              a.snapshots.map((s) => ({ balanceMinor: s.balanceMinor, asOf: s.asOf.toISOString() })),
            );
            return (
              <li key={a.id}>
                <Link href={`/investments/${a.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-muted/50">
                  <span>
                    <span className="font-medium">{a.name}</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      {a.type} · {a.institution}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums">
                    {formatMinorUnits(balance.balanceMinor, a.currency as Currency)}{" "}
                    <span className="text-xs text-muted-foreground">{a.currency}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
```

- [x] **Step 2: Create the add-account page**

Create `src/app/investments/new/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createAccount } from "@/app/investments/actions";
import { requireUserId } from "@/lib/require-user";

const TYPES = ["RRSP", "TFSA", "RDSP", "FHSA", "ROTH_IRA", "NON_REGISTERED", "CASH", "CHEQUING", "CRYPTO"] as const;
const CURRENCIES = ["CAD", "USD", "JMD"] as const;

export default async function NewAccountPage() {
  await requireUserId();

  async function submit(formData: FormData) {
    "use server";
    const result = await createAccount(formData);
    if (result.ok) redirect("/investments");
    redirect(`/investments/new?error=${encodeURIComponent(result.error)}`);
  }

  return (
    <main className="py-8">
      <h1 className="text-xl font-semibold">Add account</h1>
      <form action={submit} className="mt-6 max-w-md space-y-4">
        <label className="block text-sm">
          Name
          <input name="name" required className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block text-sm">
          Institution
          <input name="institution" required className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block text-sm">
          Type
          <select name="type" required className="mt-1 w-full rounded border px-3 py-2">
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block text-sm">
            Country (2-letter)
            <input name="country" defaultValue="CA" required pattern="[A-Z]{2}" className="mt-1 w-full rounded border px-3 py-2" />
          </label>
          <label className="block text-sm">
            Currency
            <select name="currency" required className="mt-1 w-full rounded border px-3 py-2">
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isUSSitus" value="true" /> US-situs account
        </label>
        <button type="submit" className="rounded bg-foreground px-4 py-2 text-sm text-background">
          Create account
        </button>
      </form>
    </main>
  );
}
```

- [x] **Step 3: Create the account detail page**

Create `src/app/investments/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { addHolding, addSnapshot, addTransaction, deleteAccount } from "@/app/investments/actions";
import { accountBalance, holdingValueMinor } from "@/engine/balance";
import { formatMinorUnits, type Currency } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

const TX_TYPES = ["CONTRIBUTION", "WITHDRAWAL", "BUY", "SELL", "DIVIDEND", "INTEREST", "FEE"] as const;

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  const account = await prisma.financialAccount.findFirst({
    where: { id, userId },
    include: {
      holdings: { orderBy: { symbol: "asc" } },
      transactions: { orderBy: { date: "desc" }, take: 50 },
      snapshots: { orderBy: { asOf: "desc" }, take: 20 },
    },
  });
  if (!account) notFound();

  const currency = account.currency as Currency;
  const balance = accountBalance(
    account.transactions.map((t) => ({ type: t.type, amountMinor: t.amountMinor, date: t.date.toISOString() })),
    account.snapshots.map((s) => ({ balanceMinor: s.balanceMinor, asOf: s.asOf.toISOString() })),
  );
  const holdingsValue = account.holdings.reduce(
    (sum, h) => sum + holdingValueMinor(Number(h.quantity), h.lastPriceMinor),
    0,
  );

  return (
    <main className="space-y-8 py-8">
      <header>
        <h1 className="text-xl font-semibold">{account.name}</h1>
        <p className="text-sm text-muted-foreground">
          {account.type} · {account.institution} · {account.currency}
        </p>
        <p className="mt-2 text-2xl tabular-nums">
          {formatMinorUnits(balance.balanceMinor, currency)}
          <span className="ml-2 text-xs text-muted-foreground">
            {balance.source === "snapshot" ? `snapshot ${balance.asOf?.slice(0, 10)}` : "derived from transactions"}
          </span>
        </p>
        {account.holdings.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Holdings market value: {formatMinorUnits(holdingsValue, currency)}
          </p>
        ) : null}
      </header>

      <section>
        <h2 className="font-medium">Holdings</h2>
        <ul className="mt-2 divide-y rounded border">
          {account.holdings.map((h) => (
            <li key={h.id} className="flex justify-between px-4 py-2 text-sm">
              <span>
                {h.symbol} <span className="text-muted-foreground">{h.name} · {h.domicileCountry}</span>
              </span>
              <span className="tabular-nums">
                {Number(h.quantity)} × {formatMinorUnits(h.lastPriceMinor, currency)} ={" "}
                {formatMinorUnits(holdingValueMinor(Number(h.quantity), h.lastPriceMinor), currency)}
              </span>
            </li>
          ))}
        </ul>
        <form action={addHolding} className="mt-3 grid max-w-2xl grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <input type="hidden" name="accountId" value={account.id} />
          <input name="symbol" placeholder="Symbol" required className="rounded border px-2 py-1" />
          <input name="name" placeholder="Name" required className="rounded border px-2 py-1" />
          <input name="domicileCountry" placeholder="Domicile (CA)" required pattern="[A-Z]{2}" className="rounded border px-2 py-1" />
          <input name="quantity" placeholder="Quantity" required className="rounded border px-2 py-1" />
          <input name="lastPriceMinor" placeholder="Price (cents)" required className="rounded border px-2 py-1" />
          <input name="priceAsOf" type="date" required className="rounded border px-2 py-1" />
          <button type="submit" className="col-span-2 rounded border px-2 py-1 sm:col-span-3">
            Add / update holding
          </button>
        </form>
      </section>

      <section>
        <h2 className="font-medium">Log a transaction</h2>
        <form action={addTransaction} className="mt-3 grid max-w-2xl grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <input type="hidden" name="accountId" value={account.id} />
          <input type="hidden" name="currency" value={account.currency} />
          <select name="type" className="rounded border px-2 py-1">
            {TX_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input name="amountMinor" placeholder="Amount (cents)" required className="rounded border px-2 py-1" />
          <input name="date" type="date" required className="rounded border px-2 py-1" />
          <input name="description" placeholder="Description" className="rounded border px-2 py-1" />
          <button type="submit" className="col-span-2 rounded border px-2 py-1 sm:col-span-4">
            Add transaction
          </button>
        </form>
        <ul className="mt-3 divide-y rounded border">
          {account.transactions.map((t) => (
            <li key={t.id} className="flex justify-between px-4 py-2 text-sm">
              <span>
                {t.date.toISOString().slice(0, 10)} {t.type}
                {t.description ? <span className="text-muted-foreground"> · {t.description}</span> : null}
              </span>
              <span className="tabular-nums">{formatMinorUnits(t.amountMinor, currency)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-medium">Balance snapshots</h2>
        <form action={addSnapshot} className="mt-3 flex max-w-md gap-2 text-sm">
          <input type="hidden" name="accountId" value={account.id} />
          <input name="balanceMinor" placeholder="Balance (cents)" required className="flex-1 rounded border px-2 py-1" />
          <input name="asOf" type="date" required className="rounded border px-2 py-1" />
          <button type="submit" className="rounded border px-2 py-1">
            Snapshot
          </button>
        </form>
        <ul className="mt-3 divide-y rounded border">
          {account.snapshots.map((s) => (
            <li key={s.id} className="flex justify-between px-4 py-2 text-sm">
              <span>{s.asOf.toISOString().slice(0, 10)}</span>
              <span className="tabular-nums">{formatMinorUnits(s.balanceMinor, currency)}</span>
            </li>
          ))}
        </ul>
      </section>

      <form action={deleteAccount}>
        <input type="hidden" name="id" value={account.id} />
        <button type="submit" className="rounded border border-red-600 px-3 py-1 text-sm text-red-600">
          Delete account (and all its data)
        </button>
      </form>
    </main>
  );
}
```

- [x] **Step 4: Verify manually**

Run: `npm run dev`. Signed in: create a fictional test account, add a holding, a transaction, and a snapshot; confirm the balance line shows `snapshot` source once a snapshot exists; delete the test account. Then: `npm test && npm run lint && npm run build` — expect pass.

- [x] **Step 5: Commit**

```bash
git add src/app/investments/
git commit -m "feat: add investments UI (account list, detail, CRUD forms)"
```

---

### Task 7: Dashboard — net worth, currency toggle, sparkline

**Files:**
- Create: `src/components/net-worth-sparkline.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `netWorth`, `netWorthSeries` (Task 4), `accountBalance` (Task 3), `convertMinor`/`MissingFxRateError` (Task 2), `formatMinorUnits`.
- Produces: `/` shows total net worth in the `?ccy=` currency (default CAD), per-account converted balances, a 90-day sparkline, and placeholder sections for Phase 2 alerts / Phase 3 upcoming payments.

- [x] **Step 1: Install recharts and build the sparkline client component**

```bash
npm install recharts
```

Create `src/components/net-worth-sparkline.tsx`:

```tsx
"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";

export function NetWorthSparkline({ data }: { data: Array<{ date: string; totalMinor: number }> }) {
  if (data.length === 0) return null;
  return (
    <div className="h-24 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip
            formatter={(value) => [`$${(Number(value) / 100).toLocaleString("en-CA")}`, "Net worth"]}
            labelFormatter={(label) => String(label)}
          />
          <Line type="monotone" dataKey="totalMinor" dot={false} strokeWidth={2} stroke="currentColor" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [x] **Step 2: Rebuild the dashboard page**

Replace `src/app/page.tsx` entirely with (keep the `PasskeyRegisterButton` and sign-out imports/forms from Phase 0):

```tsx
import Link from "next/link";
import { signOut } from "@/auth";
import { NetWorthSparkline } from "@/components/net-worth-sparkline";
import { PasskeyRegisterButton } from "@/components/passkey-buttons";
import { accountBalance } from "@/engine/balance";
import { MissingFxRateError, type FxRateInput } from "@/engine/fx";
import { formatMinorUnits, type Currency } from "@/engine/money";
import { netWorth, netWorthSeries, type SnapshotRow } from "@/engine/networth";
import { prisma } from "@/lib/prisma";
import { requireUser, requireUserId } from "@/lib/require-user";

const CURRENCIES: Currency[] = ["CAD", "USD", "JMD"];

export default async function Home({ searchParams }: { searchParams: Promise<{ ccy?: string }> }) {
  const user = await requireUser();
  const userId = await requireUserId();
  const { ccy } = await searchParams;
  const display: Currency = CURRENCIES.includes(ccy as Currency) ? (ccy as Currency) : "CAD";

  const [accounts, fxRates] = await Promise.all([
    prisma.financialAccount.findMany({
      where: { userId },
      include: { transactions: true, snapshots: true },
      orderBy: { name: "asc" },
    }),
    prisma.fxRate.findMany({ where: { userId } }),
  ]);

  const rates: FxRateInput[] = fxRates.map((r) => ({
    base: r.base as Currency,
    quote: r.quote as Currency,
    rate: Number(r.rate),
    asOf: r.asOf.toISOString(),
  }));

  const rows = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type as string,
    currency: a.currency as Currency,
    balanceMinor: accountBalance(
      a.transactions.map((t) => ({ type: t.type, amountMinor: t.amountMinor, date: t.date.toISOString() })),
      a.snapshots.map((s) => ({ balanceMinor: s.balanceMinor, asOf: s.asOf.toISOString() })),
    ).balanceMinor,
  }));

  let total: ReturnType<typeof netWorth> | null = null;
  let missingRate: string | null = null;
  try {
    total = netWorth(rows, display, rates);
  } catch (e) {
    if (e instanceof MissingFxRateError) missingRate = e.message;
    else throw e;
  }

  const snapshotRows: SnapshotRow[] = accounts.flatMap((a) =>
    a.snapshots.map((s) => ({
      accountId: a.id,
      balanceMinor: s.balanceMinor,
      currency: a.currency as Currency,
      asOf: s.asOf.toISOString(),
    })),
  );
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 89 * 86_400_000).toISOString().slice(0, 10);
  let series: Array<{ date: string; totalMinor: number }> = [];
  try {
    series = netWorthSeries(snapshotRows, display, rates, from, today);
  } catch {
    // missing FX rate for a historical snapshot — sparkline is optional, skip it
  }

  return (
    <main className="space-y-8 py-8">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Signed in as {user.email}</p>
        </div>
        <nav className="flex gap-1 rounded border p-1 text-xs">
          {CURRENCIES.map((c) => (
            <Link
              key={c}
              href={`/?ccy=${c}`}
              className={`rounded px-2 py-1 ${c === display ? "bg-foreground text-background" : ""}`}
            >
              {c}
            </Link>
          ))}
        </nav>
      </header>

      <section>
        <h2 className="text-sm text-muted-foreground">Net worth ({display})</h2>
        {total ? (
          <p className="text-3xl font-semibold tabular-nums">{formatMinorUnits(total.totalMinor, display)}</p>
        ) : (
          <p className="text-sm text-red-600">
            {missingRate}. <Link href="/investments" className="underline">Add an FX rate via import</Link>.
          </p>
        )}
        <NetWorthSparkline data={series} />
      </section>

      {total && total.perAccount.length > 0 ? (
        <section className="grid gap-3 sm:grid-cols-2">
          {total.perAccount.map((a) => (
            <Link key={a.id} href={`/investments/${a.id}`} className="rounded border p-4 hover:bg-muted/50">
              <p className="text-sm font-medium">{a.name}</p>
              <p className="text-xs text-muted-foreground">{a.type}</p>
              <p className="mt-1 tabular-nums">
                {formatMinorUnits(a.displayMinor, display)}
                {a.currency !== display ? (
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({formatMinorUnits(a.balanceMinor, a.currency)} {a.currency})
                  </span>
                ) : null}
              </p>
            </Link>
          ))}
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          No accounts yet — <Link href="/investments" className="underline">add or import them</Link>.
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
          Alerts &amp; opportunities — Phase 2
        </div>
        <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
          Upcoming payments — Phase 3
        </div>
      </section>

      <div className="flex items-center gap-3">
        <PasskeyRegisterButton />
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" className="rounded border px-3 py-1 text-sm">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
```

- [x] **Step 3: Verify manually**

Run: `npm run dev`. With a couple of fictional accounts + snapshots + a USD→CAD rate entered: totals render, the CAD/USD/JMD toggle changes converted values (JMD without a rate shows the missing-rate message rather than crashing), sparkline draws once ≥2 snapshot days exist. Then `npm test && npm run lint && npm run build` — expect pass.

- [x] **Step 4: Commit**

```bash
git add src/app/page.tsx src/components/net-worth-sparkline.tsx package.json package-lock.json
git commit -m "feat: add net worth dashboard with currency toggle and sparkline"
```

---

### Task 8: Authenticated JSON import + format doc

**Files:**
- Create: `src/app/investments/import/page.tsx`, `src/app/investments/import/actions.ts`, `docs/import-format.md`, `e2e/fixtures/import-sample.json`

**Interfaces:**
- Consumes: `importFile` schema (Task 5), `requireUserId`, `prisma`.
- Produces: `/investments/import` — upload a JSON file, get created/updated counts. Idempotent by natural keys: account `(userId, name, institution)`, holding `(accountId, symbol)`, snapshot `(accountId, asOf)`, fx `(userId, base, quote, asOf)`. Re-importing the same file changes nothing.

- [x] **Step 1: Create the import action**

Create `src/app/investments/import/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { importFile } from "@/lib/validation/investments";

export interface ImportResult {
  ok: boolean;
  error?: string;
  accounts?: number;
  holdings?: number;
  snapshots?: number;
  fxRates?: number;
}

export async function importJson(formData: FormData): Promise<ImportResult> {
  const userId = await requireUserId();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file uploaded" };

  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    return { ok: false, error: "File is not valid JSON" };
  }

  const parsed = importFile.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue.path.join(".")}: ${issue.message}` };
  }

  let accounts = 0;
  let holdings = 0;
  let snapshots = 0;
  let fxRates = 0;

  for (const entry of parsed.data.accounts) {
    const { holdings: hs, snapshots: ss, ...accountData } = entry;
    const existing = await prisma.financialAccount.findFirst({
      where: { userId, name: accountData.name, institution: accountData.institution },
    });
    const account = existing
      ? await prisma.financialAccount.update({ where: { id: existing.id }, data: accountData })
      : await prisma.financialAccount.create({ data: { ...accountData, userId } });
    accounts += 1;

    for (const h of hs ?? []) {
      await prisma.holding.upsert({
        where: { accountId_symbol: { accountId: account.id, symbol: h.symbol } },
        update: { ...h, priceAsOf: new Date(h.priceAsOf) },
        create: { ...h, accountId: account.id, priceAsOf: new Date(h.priceAsOf) },
      });
      holdings += 1;
    }

    for (const s of ss ?? []) {
      await prisma.balanceSnapshot.upsert({
        where: { accountId_asOf: { accountId: account.id, asOf: new Date(s.asOf) } },
        update: { balanceMinor: s.balanceMinor },
        create: {
          accountId: account.id,
          balanceMinor: s.balanceMinor,
          currency: account.currency,
          asOf: new Date(s.asOf),
        },
      });
      snapshots += 1;
    }
  }

  for (const r of parsed.data.fxRates ?? []) {
    await prisma.fxRate.upsert({
      where: { userId_base_quote_asOf: { userId, base: r.base, quote: r.quote, asOf: new Date(r.asOf) } },
      update: { rate: r.rate },
      create: { userId, base: r.base, quote: r.quote, rate: r.rate, asOf: new Date(r.asOf) },
    });
    fxRates += 1;
  }

  revalidatePath("/investments");
  revalidatePath("/");
  return { ok: true, accounts, holdings, snapshots, fxRates };
}
```

- [x] **Step 2: Create the import page**

Create `src/app/investments/import/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/require-user";
import { importJson } from "./actions";

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  await requireUserId();
  const { done, error } = await searchParams;

  async function submit(formData: FormData) {
    "use server";
    const result = await importJson(formData);
    if (result.ok) {
      redirect(
        `/investments/import?done=${result.accounts} accounts, ${result.holdings} holdings, ${result.snapshots} snapshots, ${result.fxRates} FX rates`,
      );
    }
    redirect(`/investments/import?error=${encodeURIComponent(result.error ?? "Import failed")}`);
  }

  return (
    <main className="py-8">
      <h1 className="text-xl font-semibold">Import data</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Upload a JSON file matching <code>docs/import-format.md</code>. Imports are idempotent —
        re-uploading the same file is safe. Your file never enters the repository; it goes straight
        to your database.
      </p>
      {done ? <p className="mt-4 text-sm text-green-700">Imported: {done}</p> : null}
      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      <form action={submit} className="mt-6 flex max-w-md items-center gap-3">
        <input type="file" name="file" accept="application/json,.json" required className="text-sm" />
        <button type="submit" className="rounded bg-foreground px-4 py-2 text-sm text-background">
          Import
        </button>
      </form>
    </main>
  );
}
```

- [x] **Step 3: Write the fictional E2E fixture**

Create `e2e/fixtures/import-sample.json` — **entirely fictional data** (5 accounts to mirror the spec's acceptance criterion):

```json
{
  "accounts": [
    {
      "type": "RRSP",
      "name": "Maple RRSP",
      "institution": "Maple Invest",
      "country": "CA",
      "currency": "CAD",
      "holdings": [
        { "symbol": "XEQT.TO", "name": "Fictional All-Equity ETF", "domicileCountry": "CA", "quantity": 100, "lastPriceMinor": 3000, "priceAsOf": "2026-08-01" }
      ],
      "snapshots": [{ "balanceMinor": 300000, "asOf": "2026-08-01" }]
    },
    {
      "type": "TFSA",
      "name": "Maple TFSA",
      "institution": "Maple Invest",
      "country": "CA",
      "currency": "CAD",
      "snapshots": [{ "balanceMinor": 150000, "asOf": "2026-08-01" }]
    },
    {
      "type": "RDSP",
      "name": "Maple RDSP",
      "institution": "Northern Trust Co (fictional)",
      "country": "CA",
      "currency": "CAD",
      "snapshots": [{ "balanceMinor": 500000, "asOf": "2026-08-01" }]
    },
    {
      "type": "ROTH_IRA",
      "name": "Eagle Roth IRA",
      "institution": "Eagle Brokerage (fictional)",
      "country": "US",
      "currency": "USD",
      "isUSSitus": true,
      "snapshots": [{ "balanceMinor": 200000, "asOf": "2026-08-01" }]
    },
    {
      "type": "CRYPTO",
      "name": "Comet Crypto",
      "institution": "Comet Exchange (fictional)",
      "country": "US",
      "currency": "USD",
      "holdings": [
        { "symbol": "BTC", "name": "Bitcoin", "domicileCountry": "US", "quantity": 0.01, "lastPriceMinor": 10000000, "priceAsOf": "2026-08-01" }
      ],
      "snapshots": [{ "balanceMinor": 100000, "asOf": "2026-08-01" }]
    }
  ],
  "fxRates": [
    { "base": "USD", "quote": "CAD", "rate": 1.4, "asOf": "2026-08-01" },
    { "base": "JMD", "quote": "CAD", "rate": 0.009, "asOf": "2026-08-01" }
  ]
}
```

- [x] **Step 4: Write the import format doc**

Create `docs/import-format.md`:

```markdown
# Import format

`/investments/import` accepts a JSON file with this shape. All amounts are
**integer minor units** (cents). Dates are ISO 8601 (`YYYY-MM-DD`). Currencies:
`CAD`, `USD`, `JMD`. Countries: ISO-3166 alpha-2.

See `e2e/fixtures/import-sample.json` for a complete fictional example.

- `accounts[]` — required. Fields: `type` (RRSP | TFSA | RDSP | FHSA | ROTH_IRA |
  NON_REGISTERED | CASH | CHEQUING | CRYPTO), `name`, `institution`, `country`,
  `currency`, optional `isUSSitus` (boolean), optional `holdings[]`, optional
  `snapshots[]`.
- `holdings[]` — `symbol`, `name`, `domicileCountry`, `quantity` (fractional ok),
  optional `bookCostMinor`, `lastPriceMinor`, `priceAsOf`.
- `snapshots[]` — `balanceMinor`, `asOf`.
- `fxRates[]` — optional. `base`, `quote`, `rate`, `asOf`.

Idempotency: accounts match on `(name, institution)`, holdings on
`(account, symbol)`, snapshots on `(account, asOf)`, FX rates on
`(base, quote, asOf)`. Re-importing updates in place; it never duplicates.

Privacy: this repo never contains real data. Keep your real import file outside
the repo (it is also blocked by `.gitignore` patterns `seed/` and `*.seed.json`).
```

- [x] **Step 5: Verify manually + commit**

Run: `npm run dev`, sign in, import `e2e/fixtures/import-sample.json` → expect "Imported: 5 accounts, 2 holdings, 5 snapshots, 2 FX rates". Import it again → same counts, no duplicates on `/investments`. Then `npm test && npm run lint && npm run build` — pass.

```bash
git add src/app/investments/import/ docs/import-format.md e2e/fixtures/
git commit -m "feat: add idempotent authenticated JSON import with format doc"
```

---

### Task 9: E2E — authenticated session helper + acceptance flow + 401 sweep

**Files:**
- Create: `e2e/helpers/session.ts`, `e2e/investments.spec.ts`
- Modify: `playwright.config.ts`, `e2e/smoke.spec.ts` (extend the 401 sweep)

**Interfaces:**
- Consumes: Prisma `Session`/`User` models (Phase 0), `e2e/fixtures/import-sample.json` (Task 8).
- Produces: `createAuthedContext(browser, baseURL)` — seeds a `User` + `Session` row directly and injects the `authjs.session-token` cookie, bypassing email/passkey for tests only (server-side enforcement is untouched); `cleanupE2EUser()`.

- [x] **Step 1: Load env for the Playwright process**

```bash
npm install -D dotenv
```

At the top of `playwright.config.ts`, add:

```ts
import { config } from "dotenv";
config({ path: ".env.local" });
```

- [x] **Step 2: Write the session helper**

Create `e2e/helpers/session.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
export const E2E_EMAIL = "e2e-test@example.com";

export async function createAuthedContext(browser: Browser, baseURL: string): Promise<BrowserContext> {
  const user = await prisma.user.upsert({
    where: { email: E2E_EMAIL },
    update: {},
    create: { email: E2E_EMAIL },
  });
  const sessionToken = randomUUID();
  await prisma.session.create({
    data: {
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const context = await browser.newContext();
  await context.addCookies([
    { name: "authjs.session-token", value: sessionToken, url: baseURL },
  ]);
  return context;
}

export async function cleanupE2EUser(): Promise<void> {
  await prisma.user.deleteMany({ where: { email: E2E_EMAIL } }); // cascades sessions + financial data
}
```

- [x] **Step 3: Write the acceptance spec**

Create `e2e/investments.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import path from "node:path";
import { cleanupE2EUser, createAuthedContext } from "./helpers/session";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupE2EUser();
});

test.afterAll(async () => {
  await cleanupE2EUser();
});

test("import fixture, see accounts with balances, toggle currency", async ({ browser, baseURL }) => {
  const context = await createAuthedContext(browser, baseURL!);
  const page = await context.newPage();

  // Import the fictional fixture
  await page.goto("/investments/import");
  await page
    .locator('input[name="file"]')
    .setInputFiles(path.join(__dirname, "fixtures", "import-sample.json"));
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText(/Imported: 5 accounts/)).toBeVisible();

  // Accounts page: all 5 with native-currency balances (spec acceptance)
  await page.goto("/investments");
  for (const name of ["Maple RRSP", "Maple TFSA", "Maple RDSP", "Eagle Roth IRA", "Comet Crypto"]) {
    await expect(page.getByText(name)).toBeVisible();
  }
  await expect(page.getByText("$3,000.00")).toBeVisible(); // Maple RRSP snapshot

  // Dashboard in CAD: 3000 + 1500 + 5000 + (2000*1.4) + (1000*1.4) = 13,700.00
  await page.goto("/?ccy=CAD");
  await expect(page.getByText("$13,700.00")).toBeVisible();

  // Toggle to USD: 3000/1.4 + 1500/1.4 + 5000/1.4 + 2000 + 1000 → 2142.86+1071.43+3571.43+3000 = 9,785.72
  await page.goto("/?ccy=USD");
  await expect(page.getByText(/9,785\.7/)).toBeVisible();

  // Idempotency: re-import, still exactly 5 account rows
  await page.goto("/investments/import");
  await page
    .locator('input[name="file"]')
    .setInputFiles(path.join(__dirname, "fixtures", "import-sample.json"));
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText(/Imported: 5 accounts/)).toBeVisible();
  await page.goto("/investments");
  await expect(page.locator("main ul li")).toHaveCount(5); // scoped: the nav's <li> items live outside <main>

  await context.close();
});
```

- [x] **Step 4: Extend the 401 sweep**

In `e2e/smoke.spec.ts`, extend the protected-API test to cover the new endpoints:

```ts
test("investment APIs return 401 when unauthenticated", async ({ request }) => {
  for (const url of ["/api/accounts", "/api/accounts/some-id"]) {
    const res = await request.get(url);
    expect(res.status()).toBe(401);
  }
});
```

- [x] **Step 5: Run the full E2E suite**

Run: `npm run e2e`
Expected: all specs pass (smoke + investments). If the exact-dollar assertions fail, recompute from the fixture by hand before touching anything — the fixture and the engine must agree; a mismatch is a bug in one of them, not in the test.

- [x] **Step 6: Full verification + commit**

Run: `npm test && npm run lint && npm run build && npm run e2e`
Expected: everything green.

```bash
git add e2e/ playwright.config.ts package.json package-lock.json
git commit -m "test: add authenticated E2E acceptance flow and extended 401 sweep"
```

---

### Task 10: Deploy + owner data import

**OWNER CHECKPOINT** (whole task).

- [ ] **Step 1: Pre-push audit and push**

Audit the full range per Global Constraints (grep the diff for personal tokens — fixtures must only contain the fictional names above). Ask the owner for permission, then `git push origin main`. Vercel auto-deploys; `prisma migrate deploy` in the build applies the Phase 1 migration to production.

- [ ] **Step 2: OWNER CHECKPOINT — real data import**

Ask the owner to prepare their real import JSON per `docs/import-format.md` (offer to draft it locally in `docs/private/` — NEVER in the repo tree outside `docs/private/`, and never committed — from the known account inventory in `docs/private/owner-context.md`, with the owner filling in current balances). Then, on the production site: sign in → Investments → Import → upload. Verify the dashboard shows their real net worth, currency toggle works, and account balances match reality.

- [ ] **Step 3: Mark Phase 1 done**

All checkboxes checked; spec Phase 1 row satisfied (accounts/holdings/transactions/snapshots CRUD, net worth dashboard with toggle, authenticated seed import). Next: plan Phase 2 (Money Finder rules engine).

---

## Self-review notes

- **Spec coverage (Phase 1 row + §4 patterns):** CRUD (T5/T6), snapshots-win rule (T3, tested), dedupe-ready transactions (schema has `dedupeHash`; full CSV dedupe is Phase 5 per spec), net worth + toggle + sparkline (T4/T7), authenticated import (T8), per-user scoping (T5 helpers + `ownedAccount` checks), append-only snapshots (upsert by `(accountId, asOf)` — corrections allowed, history preserved). ✔
- **Acceptance criteria:** "5 accounts with correct balances in native currency and converted totals" → T9 E2E mirrors it with fictional data. ✔
- **Type consistency:** `TxTypeName` matches Prisma `TxType` values; `FxRateInput` shared by fx/networth; `accountBalance` return shape used in T5 API + T6/T7 pages; `Currency` imported from `money.ts` everywhere. ✔
- **Known risks stated:** Prisma `Int` amount cap (Global Constraints); latest-rates-for-history approximation (Global Constraints); `authjs.session-token` cookie name is Auth.js v5's http-localhost default — if Playwright auth fails, inspect the real cookie name in the browser and update the helper.
