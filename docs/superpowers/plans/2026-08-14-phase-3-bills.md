# MoneyTalks Phase 3 (Bills) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Bills module — recurring bills with effective-dated amount schedules, a recurrence engine that gets biweekly math exactly right (26 payments/yr, triple-payment months flagged), a month view and 12-month cash-flow forecast, mark-as-paid actuals, a 14-day upcoming strip on the dashboard, and the three bill-dependent Money Finder rules deferred from Phase 2.

**Architecture:** All date logic is pure engine code (`src/engine/recurrence.ts`, `src/engine/billforecast.ts`) operating in **plain calendar-date space** (`YYYY-MM-DD` strings + `Date.UTC` arithmetic) — never timestamps, so DST can't shift a due date. A bill's amount is a timeline (`schedule[]`), resolved per occurrence date. `Payment` rows exist only for logged actuals/mark-as-paid (keyed `billId + dueDate`); upcoming occurrences are computed fresh, mirroring the rules engine's no-stored-alerts principle.

**Tech Stack:** No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-14-moneytalks-design.md`

**Prerequisite:** Phases 0–2 complete (engines, `requireUserId`, validation modules, import, rules registry with 19 rule objects, E2E session helper).

## Global Constraints

All Phase 0–2 Global Constraints apply verbatim (public repo — zero personal data anywhere including fixtures; integer minor units; pure engines with "now"/"today" as parameters; strict TS; userId scoping; TDD; commit trailer; OWNER CHECKPOINT protocol). Phase-3 additions:

- **Never approximate biweekly as semi-monthly.** Biweekly = anchor + 14n days, 26/yr, two triple-payment months whose position depends on the anchor. The engine tests pin this against hand-verified 2026 calendar facts.
- Occurrence generators take bounded windows and **throw beyond 60 months** — no unbounded loops.
- On overlapping schedule entries, the entry with the **latest `from`** wins (documented tie-break; validation warns but does not block).
- Bills carry a `currency` (default CAD); all bill amounts are in the bill's own currency.
- The three deferred rules (digital news, student-loan interest, mortgage prepayment) use **hedged language** — they match bills heuristically by name/category and always tell the user what to verify.

---

### Task 1: Schema — Bill + Payment models

**Files:**
- Modify: `prisma/schema.prisma` (add models; add `bills Bill[]` relation to `User`)

**Interfaces:**
- Produces: `Bill` (cadence + schedule as validated JSON columns) and `Payment` (actuals only, unique per `billId + dueDate`).

- [ ] **Step 1: Extend the schema**

Append to `prisma/schema.prisma`:

```prisma
// ---- Bills (Phase 3) ----

model Bill {
  id                 String    @id @default(cuid())
  userId             String
  user               User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  name               String
  category           String // housing | utilities | subscriptions | transport | debt | other
  payee              String?
  sourceAccountId    String? // informational link to a FinancialAccount
  currency           String    @default("CAD")
  autopay            Boolean   @default(false)
  variable           Boolean   @default(false)
  notes              String?
  cadence            Json // {type: BIWEEKLY|MONTHLY|QUARTERLY|ANNUAL, ...} — validated by zod
  schedule           Json // [{from, to?, amountMinor, note?}] — validated by zod
  prepaymentMonthDay String? // "03-15" — enables the mortgage-prepayment reminder rule
  interestRatePct    Decimal? // enables the rough interest-saved estimate
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  payments           Payment[]

  @@unique([userId, name])
}

model Payment {
  id                  String    @id @default(cuid())
  billId              String
  bill                Bill      @relation(fields: [billId], references: [id], onDelete: Cascade)
  dueDate             DateTime
  expectedAmountMinor Int
  actualAmountMinor   Int?
  paidAt              DateTime?

  @@unique([billId, dueDate])
}
```

- [ ] **Step 2: Migrate, verify, commit**

```bash
npx dotenv -e .env.local -- npx prisma migrate dev --name bills-and-payments
npx dotenv -e .env.local -- npx prisma migrate status
npm run build
git add prisma/
git commit -m "feat: add Bill and Payment models"
```

---

### Task 2: Engine — schedule resolution + cadence occurrence generation

The core date math. Every expectation below is a hand-verified calendar fact.

**Files:**
- Create: `src/engine/recurrence.ts`, `src/engine/recurrence.test.ts`

**Interfaces:**
- Produces:
  - `type Cadence = { type: "BIWEEKLY"; anchor: string } | { type: "MONTHLY"; dayOfMonth: number; startsFrom?: string; activeMonths?: number[] } | { type: "QUARTERLY"; anchor: string } | { type: "ANNUAL"; anchor: string }`
  - `interface ScheduleEntry { from: string; to?: string; amountMinor: number; note?: string }`
  - `amountOn(schedule: ScheduleEntry[], date: string): number | null` — latest-`from` entry whose range contains the date; null when none.
  - `occurrencesBetween(cadence: Cadence, from: string, to: string): string[]` — sorted `YYYY-MM-DD` dates; throws `RangeError` if the window exceeds 60 months or `from > to`.

- [ ] **Step 1: Write the failing test**

Create `src/engine/recurrence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { amountOn, occurrencesBetween, type Cadence, type ScheduleEntry } from "./recurrence";

describe("amountOn — the effective-dated amount pattern", () => {
  // Modeled on a promo that steps up twice (fictional amounts)
  const stepped: ScheduleEntry[] = [
    { from: "2025-09-01", to: "2026-08-31", amountMinor: 1000 },
    { from: "2026-09-01", to: "2027-08-31", amountMinor: 1500 },
    { from: "2027-09-01", amountMinor: 2000 },
  ];

  it("resolves each step by date range, inclusive on both ends", () => {
    expect(amountOn(stepped, "2026-08-31")).toBe(1000);
    expect(amountOn(stepped, "2026-09-01")).toBe(1500);
    expect(amountOn(stepped, "2027-08-31")).toBe(1500);
    expect(amountOn(stepped, "2027-09-01")).toBe(2000);
    expect(amountOn(stepped, "2030-01-01")).toBe(2000); // open-ended tail
  });

  it("returns null before the first entry", () => {
    expect(amountOn(stepped, "2025-08-31")).toBeNull();
  });

  it("on overlap, the latest 'from' wins", () => {
    const overlapping: ScheduleEntry[] = [
      { from: "2026-01-01", amountMinor: 100 },
      { from: "2026-06-01", amountMinor: 200 },
    ];
    expect(amountOn(overlapping, "2026-07-01")).toBe(200);
    expect(amountOn(overlapping, "2026-03-01")).toBe(100);
  });
});

describe("occurrencesBetween — BIWEEKLY", () => {
  const biweekly: Cadence = { type: "BIWEEKLY", anchor: "2026-01-07" }; // a Wednesday

  it("produces exactly 26 payments in 2026", () => {
    expect(occurrencesBetween(biweekly, "2026-01-01", "2026-12-31")).toHaveLength(26);
  });

  it("lands on 14-day steps from the anchor", () => {
    const dates = occurrencesBetween(biweekly, "2026-01-01", "2026-02-28");
    expect(dates).toEqual(["2026-01-07", "2026-01-21", "2026-02-04", "2026-02-18"]);
  });

  it("April and September 2026 are the triple-payment months for this anchor", () => {
    expect(occurrencesBetween(biweekly, "2026-04-01", "2026-04-30")).toEqual([
      "2026-04-01", "2026-04-15", "2026-04-29",
    ]);
    expect(occurrencesBetween(biweekly, "2026-09-01", "2026-09-30")).toEqual([
      "2026-09-02", "2026-09-16", "2026-09-30",
    ]);
  });

  it("works when the window starts long after the anchor", () => {
    expect(occurrencesBetween(biweekly, "2027-01-01", "2027-01-31")).toEqual([
      "2027-01-06", "2027-01-20",
    ]);
  });
});

describe("occurrencesBetween — MONTHLY", () => {
  it("clamps dayOfMonth to short months", () => {
    const eom: Cadence = { type: "MONTHLY", dayOfMonth: 31 };
    expect(occurrencesBetween(eom, "2026-02-01", "2026-04-30")).toEqual([
      "2026-02-28", "2026-03-31", "2026-04-30", // 2026 is not a leap year
    ]);
  });

  it("respects startsFrom and activeMonths (the property-tax instalment pattern)", () => {
    const instalments: Cadence = {
      type: "MONTHLY",
      dayOfMonth: 1,
      startsFrom: "2027-02-01",
      activeMonths: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    };
    expect(occurrencesBetween(instalments, "2026-01-01", "2026-12-31")).toEqual([]);
    const in2027 = occurrencesBetween(instalments, "2027-01-01", "2027-12-31");
    expect(in2027).toHaveLength(11); // Feb–Dec, no January
    expect(in2027[0]).toBe("2027-02-01");
    expect(in2027[10]).toBe("2027-12-01");
  });
});

describe("occurrencesBetween — QUARTERLY and ANNUAL", () => {
  it("steps quarterly in 3-month jumps with day clamping", () => {
    const q: Cadence = { type: "QUARTERLY", anchor: "2026-11-30" };
    expect(occurrencesBetween(q, "2026-11-01", "2027-06-30")).toEqual([
      "2026-11-30", "2027-02-28", "2027-05-30",
    ]);
  });

  it("steps annually", () => {
    const a: Cadence = { type: "ANNUAL", anchor: "2026-03-15" };
    expect(occurrencesBetween(a, "2026-01-01", "2028-12-31")).toEqual([
      "2026-03-15", "2027-03-15", "2028-03-15",
    ]);
  });
});

describe("bounds", () => {
  it("throws on windows over 60 months or inverted ranges", () => {
    const m: Cadence = { type: "MONTHLY", dayOfMonth: 1 };
    expect(() => occurrencesBetween(m, "2026-01-01", "2031-02-01")).toThrow(RangeError);
    expect(() => occurrencesBetween(m, "2026-02-01", "2026-01-01")).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` — expect FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/engine/recurrence.ts`:

```ts
export type Cadence =
  | { type: "BIWEEKLY"; anchor: string }
  | { type: "MONTHLY"; dayOfMonth: number; startsFrom?: string; activeMonths?: number[] }
  | { type: "QUARTERLY"; anchor: string }
  | { type: "ANNUAL"; anchor: string };

export interface ScheduleEntry {
  from: string;
  to?: string;
  amountMinor: number;
  note?: string;
}

const DAY_MS = 86_400_000;

function parse(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

function toMs(date: string): number {
  const { y, m, d } = parse(date);
  return Date.UTC(y, m - 1, d);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based; day 0 of next month
}

function clampedDate(y: number, m: number, d: number): string {
  return toIso(Date.UTC(y, m - 1, Math.min(d, daysInMonth(y, m))));
}

export function amountOn(schedule: ScheduleEntry[], date: string): number | null {
  const candidates = schedule.filter(
    (s) => s.from <= date && (s.to === undefined || date <= s.to),
  );
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => (a.from < b.from ? 1 : -1))[0].amountMinor;
}

function monthsBetween(from: string, to: string): number {
  const a = parse(from);
  const b = parse(to);
  return (b.y - a.y) * 12 + (b.m - a.m);
}

export function occurrencesBetween(cadence: Cadence, from: string, to: string): string[] {
  if (from > to) throw new RangeError(`window is inverted: ${from} > ${to}`);
  if (monthsBetween(from, to) > 60) {
    throw new RangeError(`window exceeds 60 months: ${from}..${to}`);
  }

  const out: string[] = [];

  if (cadence.type === "BIWEEKLY") {
    const anchorMs = toMs(cadence.anchor);
    const fromMs = toMs(from);
    const steps = anchorMs >= fromMs ? 0 : Math.ceil((fromMs - anchorMs) / (14 * DAY_MS));
    for (let ms = anchorMs + steps * 14 * DAY_MS; ms <= toMs(to); ms += 14 * DAY_MS) {
      if (ms >= fromMs) out.push(toIso(ms));
    }
    return out;
  }

  if (cadence.type === "MONTHLY") {
    const start = cadence.startsFrom && cadence.startsFrom > from ? cadence.startsFrom : from;
    let { y, m } = parse(start);
    const end = parse(to);
    while (y < end.y || (y === end.y && m <= end.m)) {
      if (!cadence.activeMonths || cadence.activeMonths.includes(m)) {
        const date = clampedDate(y, m, cadence.dayOfMonth);
        if (date >= start && date >= from && date <= to) out.push(date);
      }
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return out;
  }

  // QUARTERLY / ANNUAL: month-stepping from the anchor with day clamping
  const stepMonths = cadence.type === "QUARTERLY" ? 3 : 12;
  const anchor = parse(cadence.anchor);
  let y = anchor.y;
  let m = anchor.m;
  for (let guard = 0; guard < 1000; guard += 1) {
    const date = clampedDate(y, m, anchor.d);
    if (date > to) break;
    if (date >= from) out.push(date);
    m += stepMonths;
    while (m > 12) {
      m -= 12;
      y += 1;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` — expect pass. If a calendar expectation fails, verify the date arithmetic against a real 2026/2027 calendar BEFORE changing either side — these are facts, not preferences.

- [ ] **Step 5: Commit**

```bash
git add src/engine/recurrence.*
git commit -m "feat: add recurrence engine (effective-dated amounts, four cadences)"
```

---

### Task 3: Engine — bill occurrences, monthly forecast, pileup flags

**Files:**
- Create: `src/engine/billforecast.ts`, `src/engine/billforecast.test.ts`

**Interfaces:**
- Consumes: `amountOn`, `occurrencesBetween`, `Cadence`, `ScheduleEntry` from `./recurrence`.
- Produces:
  - `interface BillDef { id: string; name: string; category: string; currency: string; autopay: boolean; variable: boolean; cadence: Cadence; schedule: ScheduleEntry[] }`
  - `interface Occurrence { billId: string; billName: string; category: string; currency: string; autopay: boolean; variable: boolean; date: string; amountMinor: number }`
  - `billOccurrences(bill: BillDef, from: string, to: string): Occurrence[]` — dates × resolved amounts; dates whose `amountOn` is null are skipped.
  - `interface MonthForecast { month: string; occurrences: Occurrence[]; totalMinor: number; cumulativeMinor: number; flags: string[] }`
  - `forecastMonths(bills: BillDef[], startMonth: string, monthsCount: number): MonthForecast[]` — `flags` contains `` `3× ${billName}` `` for any bill with ≥3 occurrences that month. Single-currency totals: bills are summed at face value; mixed currencies are the UI's concern (v1 displays per-bill currency; totals assume CAD-dominant reality — documented).

- [ ] **Step 1: Write the failing test**

Create `src/engine/billforecast.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { billOccurrences, forecastMonths, type BillDef } from "./billforecast";

const mortgage: BillDef = {
  id: "b1",
  name: "Fixture Mortgage",
  category: "housing",
  currency: "CAD",
  autopay: true,
  variable: false,
  cadence: { type: "BIWEEKLY", anchor: "2026-01-07" },
  schedule: [{ from: "2020-01-01", amountMinor: 100_000 }],
};

const condo: BillDef = {
  id: "b2",
  name: "Fixture Condo Fees",
  category: "housing",
  currency: "CAD",
  autopay: true,
  variable: false,
  cadence: { type: "MONTHLY", dayOfMonth: 1 },
  schedule: [
    { from: "2020-01-01", to: "2026-07-31", amountMinor: 40_000 },
    { from: "2026-08-01", amountMinor: 42_000 },
  ],
};

const stepped: BillDef = {
  id: "b3",
  name: "Fixture Stream Bundle",
  category: "subscriptions",
  currency: "CAD",
  autopay: true,
  variable: false,
  cadence: { type: "MONTHLY", dayOfMonth: 1 },
  schedule: [
    { from: "2025-09-01", to: "2026-08-31", amountMinor: 1000 },
    { from: "2026-09-01", amountMinor: 1_500 },
  ],
};

describe("billOccurrences", () => {
  it("pairs each occurrence with its date-resolved amount", () => {
    const occ = billOccurrences(stepped, "2026-08-01", "2026-10-31");
    expect(occ.map((o) => [o.date, o.amountMinor])).toEqual([
      ["2026-08-01", 1000],
      ["2026-09-01", 1_500],
      ["2026-10-01", 1_500],
    ]);
  });

  it("applies the amount change mid-window (condo increase Aug 2026)", () => {
    const occ = billOccurrences(condo, "2026-07-01", "2026-08-31");
    expect(occ.map((o) => o.amountMinor)).toEqual([40_000, 42_000]);
  });

  it("skips dates with no schedule coverage", () => {
    const late: BillDef = { ...condo, schedule: [{ from: "2026-06-01", amountMinor: 100 }] };
    expect(billOccurrences(late, "2026-05-01", "2026-06-30")).toHaveLength(1);
  });
});

describe("forecastMonths", () => {
  it("computes totals, cumulative, and triple-payment flags across 12 months", () => {
    const forecast = forecastMonths([mortgage, condo], "2026-01", 12);
    expect(forecast).toHaveLength(12);

    const jan = forecast[0];
    // Jan 2026: mortgage 7th + 21st (2 × 1000.00) + condo 1st (400.00) = 2400.00
    expect(jan.month).toBe("2026-01");
    expect(jan.totalMinor).toBe(240_000);
    expect(jan.flags).toEqual([]);

    const apr = forecast[3];
    // Apr 2026: TRIPLE mortgage (1st, 15th, 29th) + condo = 3 × 1000.00 + 400.00 = 3400.00
    expect(apr.totalMinor).toBe(340_000);
    expect(apr.flags).toEqual(["3× Fixture Mortgage"]);

    const sep = forecast[8];
    // Sep 2026: TRIPLE mortgage + condo at the increased rate = 3 × 1000.00 + 420.00 = 3420.00
    expect(sep.totalMinor).toBe(342_000);
    expect(sep.flags).toEqual(["3× Fixture Mortgage"]);

    // Cumulative is a running sum
    expect(forecast[1].cumulativeMinor).toBe(jan.totalMinor + forecast[1].totalMinor);
  });

  it("bounds monthsCount", () => {
    expect(() => forecastMonths([condo], "2026-01", 61)).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` — expect FAIL.

- [ ] **Step 3: Implement**

Create `src/engine/billforecast.ts`:

```ts
import { amountOn, occurrencesBetween, type Cadence, type ScheduleEntry } from "./recurrence";

export interface BillDef {
  id: string;
  name: string;
  category: string;
  currency: string;
  autopay: boolean;
  variable: boolean;
  cadence: Cadence;
  schedule: ScheduleEntry[];
}

export interface Occurrence {
  billId: string;
  billName: string;
  category: string;
  currency: string;
  autopay: boolean;
  variable: boolean;
  date: string;
  amountMinor: number;
}

export function billOccurrences(bill: BillDef, from: string, to: string): Occurrence[] {
  return occurrencesBetween(bill.cadence, from, to).flatMap((date) => {
    const amountMinor = amountOn(bill.schedule, date);
    if (amountMinor === null) return [];
    return [
      {
        billId: bill.id,
        billName: bill.name,
        category: bill.category,
        currency: bill.currency,
        autopay: bill.autopay,
        variable: bill.variable,
        date,
        amountMinor,
      },
    ];
  });
}

export interface MonthForecast {
  month: string; // YYYY-MM
  occurrences: Occurrence[];
  totalMinor: number;
  cumulativeMinor: number;
  flags: string[];
}

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

function addMonths(month: string, count: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + count;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

export function forecastMonths(
  bills: BillDef[],
  startMonth: string,
  monthsCount: number,
): MonthForecast[] {
  if (monthsCount < 1 || monthsCount > 60) {
    throw new RangeError(`monthsCount must be 1..60, got ${monthsCount}`);
  }
  const result: MonthForecast[] = [];
  let cumulative = 0;

  for (let i = 0; i < monthsCount; i += 1) {
    const month = addMonths(startMonth, i);
    const occurrences = bills
      .flatMap((bill) => billOccurrences(bill, `${month}-01`, monthEnd(month)))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const totalMinor = occurrences.reduce((sum, o) => sum + o.amountMinor, 0);
    cumulative += totalMinor;

    const counts = new Map<string, { name: string; count: number }>();
    for (const o of occurrences) {
      const entry = counts.get(o.billId) ?? { name: o.billName, count: 0 };
      entry.count += 1;
      counts.set(o.billId, entry);
    }
    const flags = [...counts.values()].filter((c) => c.count >= 3).map((c) => `3× ${c.name}`);

    result.push({ month, occurrences, totalMinor, cumulativeMinor: cumulative, flags });
  }
  return result;
}
```

- [ ] **Step 4: Run tests, commit**

Run: `npm test` — expect pass (hand-check any failure against the arithmetic in the test comments first).

```bash
git add src/engine/billforecast.*
git commit -m "feat: add bill forecast engine with triple-payment pileup flags"
```

---

### Task 4: Validation, server actions, import extension

**Files:**
- Create: `src/lib/validation/bills.ts`, `src/lib/validation/bills.test.ts`, `src/app/bills/actions.ts`
- Modify: `src/lib/validation/investments.ts` (extend `importFile`), `src/app/investments/import/actions.ts` (bills import loop), `docs/import-format.md`

**Interfaces:**
- Consumes: `prisma`, `requireUserId`, engine types.
- Produces:
  - Zod: `cadenceInput` (discriminated union matching `Cadence`), `scheduleEntryInput`, `billInput` (bill fields + cadence + schedule as JSON strings from form fields, parsed and validated), `billImportEntry`.
  - Actions: `createBill`, `deleteBill`, `addScheduleEntry`, `removeScheduleEntry`, `markPaid` (upserts a `Payment` with `paidAt`, `expectedAmountMinor` from the engine, `actualAmountMinor` from the form or defaulting to expected), `unmarkPaid`.
  - `importFile` gains optional `bills[]`; import upserts by `(userId, name)`.

- [ ] **Step 1: Write the failing validation test**

Create `src/lib/validation/bills.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { billImportEntry, cadenceInput } from "./bills";

describe("cadenceInput", () => {
  it("accepts each cadence shape", () => {
    expect(cadenceInput.safeParse({ type: "BIWEEKLY", anchor: "2026-01-07" }).success).toBe(true);
    expect(
      cadenceInput.safeParse({
        type: "MONTHLY",
        dayOfMonth: 1,
        startsFrom: "2027-02-01",
        activeMonths: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      }).success,
    ).toBe(true);
    expect(cadenceInput.safeParse({ type: "QUARTERLY", anchor: "2026-09-30" }).success).toBe(true);
  });

  it("rejects a biweekly cadence without an anchor and bad day numbers", () => {
    expect(cadenceInput.safeParse({ type: "BIWEEKLY" }).success).toBe(false);
    expect(cadenceInput.safeParse({ type: "MONTHLY", dayOfMonth: 32 }).success).toBe(false);
  });
});

describe("billImportEntry", () => {
  it("accepts a full bill with stepped schedule", () => {
    const parsed = billImportEntry.safeParse({
      name: "Fixture Stream Bundle",
      category: "subscriptions",
      autopay: true,
      cadence: { type: "MONTHLY", dayOfMonth: 1 },
      schedule: [
        { from: "2025-09-01", to: "2026-08-31", amountMinor: 1000 },
        { from: "2026-09-01", amountMinor: 1500 },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("requires at least one schedule entry", () => {
    expect(
      billImportEntry.safeParse({
        name: "x",
        category: "other",
        cadence: { type: "MONTHLY", dayOfMonth: 1 },
        schedule: [],
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement the schemas**

Run: `npm test` — FAIL. Then create `src/lib/validation/bills.ts`:

```ts
import { z } from "zod";
import { currencyCode } from "./investments";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const minor = z.coerce.number().int().safe();

export const cadenceInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("BIWEEKLY"), anchor: isoDate }),
  z.object({
    type: z.literal("MONTHLY"),
    dayOfMonth: z.coerce.number().int().min(1).max(31),
    startsFrom: isoDate.optional(),
    activeMonths: z.array(z.number().int().min(1).max(12)).nonempty().optional(),
  }),
  z.object({ type: z.literal("QUARTERLY"), anchor: isoDate }),
  z.object({ type: z.literal("ANNUAL"), anchor: isoDate }),
]);

export const scheduleEntryInput = z
  .object({
    from: isoDate,
    to: isoDate.optional(),
    amountMinor: minor.positive(),
    note: z.string().trim().max(200).optional(),
  })
  .refine((s) => s.to === undefined || s.from <= s.to, { message: "from must be <= to" });

export const billCore = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.enum(["housing", "utilities", "subscriptions", "transport", "debt", "other"]),
  payee: z.string().trim().max(80).optional(),
  currency: currencyCode.default("CAD"),
  autopay: z.coerce.boolean().default(false),
  variable: z.coerce.boolean().default(false),
  notes: z.string().trim().max(500).optional(),
  prepaymentMonthDay: z.string().regex(/^\d{2}-\d{2}$/).optional(),
  interestRatePct: z.coerce.number().positive().max(30).optional(),
});

export const billImportEntry = billCore.extend({
  cadence: cadenceInput,
  schedule: z.array(scheduleEntryInput).min(1),
});

// Form variant: cadence + schedule arrive as JSON strings from hidden/textarea fields
export const billFormInput = billCore.extend({
  cadenceJson: z.string().transform((s, ctx) => {
    try {
      return cadenceInput.parse(JSON.parse(s));
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid cadence JSON" });
      return z.NEVER;
    }
  }),
  scheduleJson: z.string().transform((s, ctx) => {
    try {
      return z.array(scheduleEntryInput).min(1).parse(JSON.parse(s));
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid schedule JSON" });
      return z.NEVER;
    }
  }),
});
```

Run: `npm test` — expect pass.

- [ ] **Step 3: Implement the bill actions**

Create `src/app/bills/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { amountOn, type Cadence, type ScheduleEntry } from "@/engine/recurrence";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { billFormInput, scheduleEntryInput } from "@/lib/validation/bills";

type ActionResult = { ok: true } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  return { ok: false, error: e instanceof Error ? e.message : "Invalid input" };
}

async function ownedBill(userId: string, billId: string) {
  const bill = await prisma.bill.findFirst({ where: { id: billId, userId } });
  if (!bill) throw new Error("Bill not found");
  return bill;
}

export async function createBill(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = billFormInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  const { cadenceJson, scheduleJson, ...core } = parsed.data;
  await prisma.bill.upsert({
    where: { userId_name: { userId, name: core.name } },
    update: { ...core, cadence: cadenceJson, schedule: scheduleJson },
    create: { ...core, userId, cadence: cadenceJson, schedule: scheduleJson },
  });
  revalidatePath("/bills");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteBill(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    const bill = await ownedBill(userId, String(formData.get("id") ?? ""));
    await prisma.bill.delete({ where: { id: bill.id } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/bills");
  revalidatePath("/");
  return { ok: true };
}

export async function addScheduleEntry(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = scheduleEntryInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  try {
    const bill = await ownedBill(userId, String(formData.get("billId") ?? ""));
    const schedule = [...(bill.schedule as unknown as ScheduleEntry[]), parsed.data];
    await prisma.bill.update({ where: { id: bill.id }, data: { schedule } });
    revalidatePath(`/bills/${bill.id}`);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function removeScheduleEntry(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const index = Number(formData.get("index"));
  try {
    const bill = await ownedBill(userId, String(formData.get("billId") ?? ""));
    const schedule = (bill.schedule as unknown as ScheduleEntry[]).filter((_, i) => i !== index);
    if (schedule.length === 0) return { ok: false, error: "A bill needs at least one schedule entry" };
    await prisma.bill.update({ where: { id: bill.id }, data: { schedule } });
    revalidatePath(`/bills/${bill.id}`);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function markPaid(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const dueDate = String(formData.get("dueDate") ?? "");
  const actualRaw = String(formData.get("actualAmountMinor") ?? "").trim();
  try {
    const bill = await ownedBill(userId, String(formData.get("billId") ?? ""));
    const expected = amountOn(bill.schedule as unknown as ScheduleEntry[], dueDate);
    if (expected === null) return { ok: false, error: "No scheduled amount on that date" };
    const actual = actualRaw === "" ? expected : Number(actualRaw);
    if (!Number.isSafeInteger(actual) || actual < 0) return { ok: false, error: "Bad actual amount" };
    await prisma.payment.upsert({
      where: { billId_dueDate: { billId: bill.id, dueDate: new Date(dueDate) } },
      update: { actualAmountMinor: actual, paidAt: new Date() },
      create: {
        billId: bill.id,
        dueDate: new Date(dueDate),
        expectedAmountMinor: expected,
        actualAmountMinor: actual,
        paidAt: new Date(),
      },
    });
    revalidatePath(`/bills/${bill.id}`);
    revalidatePath("/bills");
    revalidatePath("/");
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function unmarkPaid(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    const bill = await ownedBill(userId, String(formData.get("billId") ?? ""));
    await prisma.payment.deleteMany({
      where: { billId: bill.id, dueDate: new Date(String(formData.get("dueDate") ?? "")) },
    });
    revalidatePath(`/bills/${bill.id}`);
    revalidatePath("/bills");
    revalidatePath("/");
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}
```

- [ ] **Step 4: Extend the import**

In `src/lib/validation/investments.ts`, add to the `importFile` object (import `billImportEntry` from `./bills`):

```ts
  bills: z.array(billImportEntry).optional(),
```

In `src/app/investments/import/actions.ts`, add a `bills` counter and, after the fxRates loop:

```ts
  for (const b of parsed.data.bills ?? []) {
    const { cadence, schedule, ...core } = b;
    await prisma.bill.upsert({
      where: { userId_name: { userId, name: core.name } },
      update: { ...core, cadence, schedule },
      create: { ...core, userId, cadence, schedule },
    });
    bills += 1;
  }
```

and include `bills` in `ImportResult` and the success redirect string (`…, ${result.bills} bills`). In `docs/import-format.md`, document the `bills[]` array: fields of `billCore` plus `cadence` (one of the four shapes) and `schedule[]` (`from`, optional `to`, `amountMinor`, optional `note`), idempotent on `(name)`.

- [ ] **Step 5: Verify + commit**

Run: `npm test && npm run lint && npm run build` — expect pass.

```bash
git add src/lib/validation/ src/app/bills/actions.ts src/app/investments/import/ docs/import-format.md
git commit -m "feat: add bill validation, actions, and import support"
```

---

### Task 5: Bills UI — grouped list + create form

**Files:**
- Modify: `src/app/bills/page.tsx` (replace placeholder)
- Create: `src/app/bills/new/page.tsx`

**Interfaces:**
- Consumes: `billOccurrences`, `amountOn`, actions, `formatMinorUnits`.
- Produces: `/bills` — bills grouped by category, each with next due date + resolved amount + autopay badge, links to month view/forecast/new; `/bills/new` — create form (cadence type select with conditional fields; first schedule entry inline; cadence/schedule serialized to the JSON form fields via a tiny client component).

- [ ] **Step 1: Replace the list page**

Replace `src/app/bills/page.tsx` entirely with:

```tsx
import Link from "next/link";
import { billOccurrences, type BillDef } from "@/engine/billforecast";
import type { Cadence, ScheduleEntry } from "@/engine/recurrence";
import { formatMinorUnits, type Currency } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

function toBillDef(b: {
  id: string; name: string; category: string; currency: string; autopay: boolean;
  variable: boolean; cadence: unknown; schedule: unknown;
}): BillDef {
  return {
    id: b.id,
    name: b.name,
    category: b.category,
    currency: b.currency,
    autopay: b.autopay,
    variable: b.variable,
    cadence: b.cadence as Cadence,
    schedule: b.schedule as ScheduleEntry[],
  };
}

export default async function BillsPage() {
  const userId = await requireUserId();
  const bills = await prisma.bill.findMany({ where: { userId }, orderBy: { name: "asc" } });
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);

  const withNext = bills.map((b) => {
    const def = toBillDef(b);
    const next = billOccurrences(def, today, horizon)[0] ?? null;
    return { bill: b, next };
  });

  const categories = [...new Set(bills.map((b) => b.category))].sort();

  return (
    <main className="space-y-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Bills</h1>
        <div className="flex gap-2 text-sm">
          <Link href="/bills/month" className="rounded border px-3 py-1">Month view</Link>
          <Link href="/bills/forecast" className="rounded border px-3 py-1">Forecast</Link>
          <Link href="/bills/new" className="rounded bg-foreground px-3 py-1 text-background">Add bill</Link>
        </div>
      </div>

      {bills.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No bills yet — add one or use <Link href="/investments/import" className="underline">Import</Link>.
        </p>
      ) : (
        categories.map((category) => (
          <section key={category}>
            <h2 className="text-sm font-medium uppercase text-muted-foreground">{category}</h2>
            <ul className="mt-2 divide-y rounded border">
              {withNext
                .filter(({ bill }) => bill.category === category)
                .map(({ bill, next }) => (
                  <li key={bill.id}>
                    <Link href={`/bills/${bill.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-muted/50">
                      <span>
                        <span className="font-medium">{bill.name}</span>{" "}
                        {bill.autopay ? <span className="rounded bg-muted px-1 text-xs">autopay</span> : null}
                        {bill.variable ? <span className="ml-1 rounded bg-muted px-1 text-xs">variable</span> : null}
                      </span>
                      <span className="text-sm tabular-nums">
                        {next ? (
                          <>
                            {next.date} · {formatMinorUnits(next.amountMinor, bill.currency as Currency)}
                            {bill.variable ? " (est.)" : ""}
                          </>
                        ) : (
                          <span className="text-muted-foreground">no upcoming date</span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
```

- [ ] **Step 2: Create the new-bill form**

Create `src/app/bills/new/page.tsx` — a client-assisted form: plain fields for `billCore`, a cadence section whose inputs are assembled into `cadenceJson`/`scheduleJson` hidden fields by a small client component:

```tsx
import { redirect } from "next/navigation";
import { createBill } from "@/app/bills/actions";
import { requireUserId } from "@/lib/require-user";
import { BillFormFields } from "./form-fields";

export default async function NewBillPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireUserId();
  const { error } = await searchParams;

  async function submit(formData: FormData) {
    "use server";
    const result = await createBill(formData);
    if (result.ok) redirect("/bills");
    redirect(`/bills/new?error=${encodeURIComponent(result.error)}`);
  }

  return (
    <main className="py-8">
      <h1 className="text-xl font-semibold">Add bill</h1>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      <form action={submit} className="mt-6 max-w-xl space-y-4">
        <BillFormFields />
        <button type="submit" className="rounded bg-foreground px-4 py-2 text-sm text-background">
          Create bill
        </button>
      </form>
    </main>
  );
}
```

Create `src/app/bills/new/form-fields.tsx`:

```tsx
"use client";

import { useState } from "react";

const input = "mt-1 w-full rounded border px-3 py-2 text-sm";
const label = "block text-sm";

export function BillFormFields() {
  const [type, setType] = useState("MONTHLY");
  const [anchor, setAnchor] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [startsFrom, setStartsFrom] = useState("");
  const [from, setFrom] = useState("");
  const [amountMinor, setAmountMinor] = useState("");

  const cadence =
    type === "MONTHLY"
      ? { type, dayOfMonth: Number(dayOfMonth), ...(startsFrom ? { startsFrom } : {}) }
      : { type, anchor };
  const schedule = [{ from, amountMinor: Number(amountMinor) }];

  return (
    <>
      <input type="hidden" name="cadenceJson" value={JSON.stringify(cadence)} />
      <input type="hidden" name="scheduleJson" value={JSON.stringify(schedule)} />

      <div className="grid grid-cols-2 gap-4">
        <label className={label}>Name<input name="name" required className={input} /></label>
        <label className={label}>Category
          <select name="category" className={input}>
            <option>housing</option><option>utilities</option><option>subscriptions</option>
            <option>transport</option><option>debt</option><option>other</option>
          </select>
        </label>
        <label className={label}>Payee<input name="payee" className={input} /></label>
        <label className={label}>Currency
          <select name="currency" className={input}><option>CAD</option><option>USD</option><option>JMD</option></select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className={label}>Cadence
          <select value={type} onChange={(e) => setType(e.target.value)} className={input}>
            <option>MONTHLY</option><option>BIWEEKLY</option><option>QUARTERLY</option><option>ANNUAL</option>
          </select>
        </label>
        {type === "MONTHLY" ? (
          <>
            <label className={label}>Day of month
              <input type="number" min={1} max={31} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} className={input} />
            </label>
            <label className={label}>Starts from (optional)
              <input type="date" value={startsFrom} onChange={(e) => setStartsFrom(e.target.value)} className={input} />
            </label>
          </>
        ) : (
          <label className={label}>
            Anchor date {type === "BIWEEKLY" ? "(a known payment date — every 14 days from here)" : ""}
            <input type="date" required value={anchor} onChange={(e) => setAnchor(e.target.value)} className={input} />
          </label>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className={label}>Amount (cents)
          <input type="number" required value={amountMinor} onChange={(e) => setAmountMinor(e.target.value)} className={input} />
        </label>
        <label className={label}>Amount effective from
          <input type="date" required value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="autopay" value="true" /> Autopay
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="variable" value="true" /> Variable amount (track actuals)
      </label>
      <label className={label}>Notes<input name="notes" className={input} /></label>
    </>
  );
}
```

- [ ] **Step 3: Verify + commit**

Run: `npm run dev` — create a fictional monthly bill and a fictional biweekly bill (anchor a known Wednesday); both appear grouped with correct next-due dates. `npm test && npm run lint && npm run build`.

```bash
git add src/app/bills/
git commit -m "feat: add bills list and create form"
```

---

### Task 6: Bill detail — schedule management, occurrences, mark-as-paid

**Files:**
- Create: `src/app/bills/[id]/page.tsx`

**Interfaces:**
- Consumes: actions from Task 4, `billOccurrences`, `formatMinorUnits`.
- Produces: `/bills/[id]` — schedule-entry table with add/remove; next-12-months occurrence list, each row showing paid status with mark-paid (+ optional actual amount for variable bills) / un-mark; estimate-vs-actual delta for logged payments; prepayment/interest metadata fields display; delete bill.

- [ ] **Step 1: Create the detail page**

Create `src/app/bills/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import {
  addScheduleEntry,
  deleteBill,
  markPaid,
  removeScheduleEntry,
  unmarkPaid,
} from "@/app/bills/actions";
import { billOccurrences, type BillDef } from "@/engine/billforecast";
import type { Cadence, ScheduleEntry } from "@/engine/recurrence";
import { formatMinorUnits, type Currency } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  const bill = await prisma.bill.findFirst({ where: { id, userId }, include: { payments: true } });
  if (!bill) notFound();

  const currency = bill.currency as Currency;
  const schedule = bill.schedule as unknown as ScheduleEntry[];
  const def: BillDef = {
    id: bill.id,
    name: bill.name,
    category: bill.category,
    currency: bill.currency,
    autopay: bill.autopay,
    variable: bill.variable,
    cadence: bill.cadence as unknown as Cadence,
    schedule,
  };
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  const upcoming = billOccurrences(def, today, horizon);
  const paidByDate = new Map(
    bill.payments.map((p) => [p.dueDate.toISOString().slice(0, 10), p]),
  );
  const pastPayments = bill.payments
    .filter((p) => p.paidAt)
    .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1))
    .slice(0, 24);

  return (
    <main className="space-y-8 py-8">
      <header>
        <h1 className="text-xl font-semibold">{bill.name}</h1>
        <p className="text-sm text-muted-foreground">
          {bill.category}{bill.payee ? ` · ${bill.payee}` : ""} · {bill.currency}
          {bill.autopay ? " · autopay" : ""}{bill.variable ? " · variable" : ""}
        </p>
        {bill.notes ? <p className="mt-1 text-sm">{bill.notes}</p> : null}
      </header>

      <section>
        <h2 className="font-medium">Amount schedule</h2>
        <ul className="mt-2 divide-y rounded border">
          {schedule.map((s, i) => (
            <li key={i} className="flex items-center justify-between px-4 py-2 text-sm">
              <span>
                {s.from} → {s.to ?? "open"} {s.note ? <span className="text-muted-foreground">· {s.note}</span> : null}
              </span>
              <span className="flex items-center gap-3 tabular-nums">
                {formatMinorUnits(s.amountMinor, currency)}
                <form action={removeScheduleEntry}>
                  <input type="hidden" name="billId" value={bill.id} />
                  <input type="hidden" name="index" value={i} />
                  <button type="submit" className="text-xs text-red-600">remove</button>
                </form>
              </span>
            </li>
          ))}
        </ul>
        <form action={addScheduleEntry} className="mt-3 flex flex-wrap gap-2 text-sm">
          <input type="hidden" name="billId" value={bill.id} />
          <input name="from" type="date" required className="rounded border px-2 py-1" />
          <input name="to" type="date" className="rounded border px-2 py-1" />
          <input name="amountMinor" placeholder="Amount (cents)" required className="rounded border px-2 py-1" />
          <input name="note" placeholder="Note" className="rounded border px-2 py-1" />
          <button type="submit" className="rounded border px-2 py-1">Add schedule entry</button>
        </form>
      </section>

      <section>
        <h2 className="font-medium">Next 12 months</h2>
        <ul className="mt-2 divide-y rounded border">
          {upcoming.map((o) => {
            const payment = paidByDate.get(o.date);
            return (
              <li key={o.date} className="flex items-center justify-between px-4 py-2 text-sm">
                <span>
                  {o.date}
                  {payment?.paidAt ? <span className="ml-2 rounded bg-muted px-1 text-xs">paid</span> : null}
                </span>
                <span className="flex items-center gap-3 tabular-nums">
                  {formatMinorUnits(o.amountMinor, currency)}{bill.variable ? " (est.)" : ""}
                  {payment?.paidAt ? (
                    <form action={unmarkPaid}>
                      <input type="hidden" name="billId" value={bill.id} />
                      <input type="hidden" name="dueDate" value={o.date} />
                      <button type="submit" className="text-xs underline">un-mark</button>
                    </form>
                  ) : (
                    <form action={markPaid} className="flex items-center gap-1">
                      <input type="hidden" name="billId" value={bill.id} />
                      <input type="hidden" name="dueDate" value={o.date} />
                      {bill.variable ? (
                        <input
                          name="actualAmountMinor"
                          placeholder="actual ¢"
                          className="w-20 rounded border px-1 py-0.5 text-xs"
                        />
                      ) : null}
                      <button type="submit" className="text-xs underline">mark paid</button>
                    </form>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {pastPayments.length > 0 ? (
        <section>
          <h2 className="font-medium">Logged payments (estimate vs actual)</h2>
          <ul className="mt-2 divide-y rounded border">
            {pastPayments.map((p) => {
              const delta = (p.actualAmountMinor ?? p.expectedAmountMinor) - p.expectedAmountMinor;
              return (
                <li key={p.id} className="flex justify-between px-4 py-2 text-sm tabular-nums">
                  <span>{p.dueDate.toISOString().slice(0, 10)}</span>
                  <span>
                    {formatMinorUnits(p.actualAmountMinor ?? p.expectedAmountMinor, currency)}
                    {delta !== 0 ? (
                      <span className={delta > 0 ? "ml-2 text-red-600" : "ml-2 text-green-700"}>
                        ({delta > 0 ? "+" : ""}{formatMinorUnits(delta, currency)} vs est.)
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <form action={deleteBill}>
        <input type="hidden" name="id" value={bill.id} />
        <button type="submit" className="rounded border border-red-600 px-3 py-1 text-sm text-red-600">
          Delete bill (and its payment log)
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Verify + commit**

Run: `npm run dev` — on a fictional bill: add a second schedule entry with a future `from`, see future occurrences switch amounts on that date; mark an occurrence paid (with an actual on a variable bill) and see the estimate-vs-actual delta; un-mark works. `npm test && npm run lint && npm run build`.

```bash
git add src/app/bills/
git commit -m "feat: add bill detail with schedule management and mark-as-paid"
```

---

### Task 7: Month view + 12-month forecast page

**Files:**
- Create: `src/app/bills/month/page.tsx`, `src/app/bills/forecast/page.tsx`, `src/components/forecast-bars.tsx`

**Interfaces:**
- Consumes: `forecastMonths`, `formatMinorUnits`.
- Produces: `/bills/month?month=YYYY-MM` — every due date that month with a running total and pileup flags, prev/next links; `/bills/forecast` — 12-month table (total, cumulative, flags) + bar chart.

- [ ] **Step 1: Month view**

Create `src/app/bills/month/page.tsx`:

```tsx
import Link from "next/link";
import { forecastMonths, type BillDef } from "@/engine/billforecast";
import type { Cadence, ScheduleEntry } from "@/engine/recurrence";
import { formatMinorUnits, type Currency } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export default async function MonthViewPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const userId = await requireUserId();
  const { month: monthParam } = await searchParams;
  const month =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam)
      ? monthParam
      : new Date().toISOString().slice(0, 7);

  const bills = await prisma.bill.findMany({ where: { userId } });
  const defs: BillDef[] = bills.map((b) => ({
    id: b.id, name: b.name, category: b.category, currency: b.currency,
    autopay: b.autopay, variable: b.variable,
    cadence: b.cadence as unknown as Cadence,
    schedule: b.schedule as unknown as ScheduleEntry[],
  }));
  const [forecast] = forecastMonths(defs, month, 1);

  const [y, m] = month.split("-").map(Number);
  const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;

  let running = 0;

  return (
    <main className="space-y-6 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{month}</h1>
        <nav className="flex gap-2 text-sm">
          <Link href={`/bills/month?month=${prev}`} className="rounded border px-3 py-1">← {prev}</Link>
          <Link href={`/bills/month?month=${next}`} className="rounded border px-3 py-1">{next} →</Link>
        </nav>
      </header>

      {forecast.flags.length > 0 ? (
        <p className="rounded border border-amber-500 p-3 text-sm" data-testid="pileup-flag">
          ⚠ Pileup month: {forecast.flags.join(", ")}
        </p>
      ) : null}

      <ul className="divide-y rounded border">
        {forecast.occurrences.map((o) => {
          running += o.amountMinor;
          return (
            <li key={`${o.billId}:${o.date}`} className="flex justify-between px-4 py-2 text-sm tabular-nums">
              <span>
                {o.date} <Link href={`/bills/${o.billId}`} className="underline">{o.billName}</Link>
                {o.autopay ? <span className="ml-1 rounded bg-muted px-1 text-xs">autopay</span> : null}
              </span>
              <span>
                {formatMinorUnits(o.amountMinor, o.currency as Currency)}
                <span className="ml-3 text-xs text-muted-foreground">Σ {formatMinorUnits(running, "CAD")}</span>
              </span>
            </li>
          );
        })}
        {forecast.occurrences.length === 0 ? (
          <li className="px-4 py-2 text-sm text-muted-foreground">No bills due this month.</li>
        ) : null}
      </ul>

      <p className="text-right text-lg font-semibold tabular-nums">
        Total: {formatMinorUnits(forecast.totalMinor, "CAD")}
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Forecast page + bars**

Create `src/components/forecast-bars.tsx`:

```tsx
"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

export function ForecastBars({ data }: { data: Array<{ month: string; totalMinor: number }> }) {
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <XAxis dataKey="month" tick={{ fontSize: 10 }} interval={1} />
          <Tooltip formatter={(v) => [`$${(Number(v) / 100).toLocaleString("en-CA")}`, "Total"]} />
          <Bar dataKey="totalMinor" fill="currentColor" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

Create `src/app/bills/forecast/page.tsx`:

```tsx
import Link from "next/link";
import { ForecastBars } from "@/components/forecast-bars";
import { forecastMonths, type BillDef } from "@/engine/billforecast";
import type { Cadence, ScheduleEntry } from "@/engine/recurrence";
import { formatMinorUnits } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export default async function ForecastPage() {
  const userId = await requireUserId();
  const bills = await prisma.bill.findMany({ where: { userId } });
  const defs: BillDef[] = bills.map((b) => ({
    id: b.id, name: b.name, category: b.category, currency: b.currency,
    autopay: b.autopay, variable: b.variable,
    cadence: b.cadence as unknown as Cadence,
    schedule: b.schedule as unknown as ScheduleEntry[],
  }));
  const startMonth = new Date().toISOString().slice(0, 7);
  const forecast = forecastMonths(defs, startMonth, 12);

  return (
    <main className="space-y-6 py-8">
      <h1 className="text-xl font-semibold">12-month forecast</h1>
      <ForecastBars data={forecast.map((f) => ({ month: f.month, totalMinor: f.totalMinor }))} />
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Month</th><th>Due</th><th>Total</th><th>Cumulative</th><th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {forecast.map((f) => (
            <tr key={f.month} className={`border-b ${f.flags.length > 0 ? "bg-amber-500/10" : ""}`}>
              <td className="py-2">
                <Link href={`/bills/month?month=${f.month}`} className="underline">{f.month}</Link>
              </td>
              <td>{f.occurrences.length}</td>
              <td>{formatMinorUnits(f.totalMinor, "CAD")}</td>
              <td>{formatMinorUnits(f.cumulativeMinor, "CAD")}</td>
              <td className="text-xs">{f.flags.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 3: Verify + commit**

Run: `npm run dev` — with the fictional biweekly bill from Task 5, the forecast highlights its triple months and month view shows the running total. `npm test && npm run lint && npm run build`.

```bash
git add src/app/bills/ src/components/forecast-bars.tsx
git commit -m "feat: add month view and 12-month forecast with pileup highlighting"
```

---

### Task 8: Dashboard — 14-day upcoming strip

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `billOccurrences`, payments, existing dashboard queries.
- Produces: the "Upcoming payments — Phase 3" placeholder replaced by the next-14-days strip with autopay badges and paid checkmarks.

- [ ] **Step 1: Implement**

In `src/app/page.tsx`, add to the data loading:

```tsx
  const bills = await prisma.bill.findMany({ where: { userId }, include: { payments: true } });
  const in14 = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const upcoming = bills
    .flatMap((b) =>
      billOccurrences(
        {
          id: b.id, name: b.name, category: b.category, currency: b.currency,
          autopay: b.autopay, variable: b.variable,
          cadence: b.cadence as unknown as Cadence,
          schedule: b.schedule as unknown as ScheduleEntry[],
        },
        today,
        in14,
      ).map((o) => ({
        ...o,
        paid: b.payments.some((p) => p.dueDate.toISOString().slice(0, 10) === o.date && p.paidAt),
      })),
    )
    .sort((a, b) => (a.date < b.date ? -1 : 1));
```

(imports: `billOccurrences` from `@/engine/billforecast`; `Cadence`, `ScheduleEntry` types from `@/engine/recurrence`). Replace the placeholder `div` with:

```tsx
        <div className="rounded border p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Next 14 days</p>
            <Link href="/bills" className="text-xs underline">bills</Link>
          </div>
          <ul className="mt-2 space-y-1 text-sm tabular-nums">
            {upcoming.map((o) => (
              <li key={`${o.billId}:${o.date}`} className="flex justify-between">
                <span>
                  {o.date.slice(5)} {o.billName}
                  {o.autopay ? <span className="ml-1 rounded bg-muted px-1 text-xs">auto</span> : null}
                  {o.paid ? " ✓" : ""}
                </span>
                <span>{formatMinorUnits(o.amountMinor, o.currency as Currency)}</span>
              </li>
            ))}
            {upcoming.length === 0 ? <li className="text-muted-foreground">Nothing due.</li> : null}
          </ul>
        </div>
```

- [ ] **Step 2: Verify + commit**

Run: `npm run dev` — the strip lists the fictional bills due in the next 14 days. `npm test && npm run lint && npm run build`.

```bash
git add src/app/page.tsx
git commit -m "feat: add 14-day upcoming payments strip to dashboard"
```

---

### Task 9: The three deferred Money Finder rules

**Files:**
- Create: `src/engine/rules/bill-rules.ts`, `src/engine/rules/bill-rules.test.ts`
- Modify: `src/engine/rules/types.ts` (add `BillView` + `bills` to `FinancialSnapshot`), `src/engine/rules/fixtures.ts` (add `makeBill`), `src/lib/snapshot.ts` (load bills), `src/engine/rules/index.ts` (register; update the registry test's key list)

**Interfaces:**
- Produces:
  - `interface BillView { id: string; name: string; category: string; notes: string | null; currency: string; prepaymentMonthDay: string | null; interestRatePct: number | null; payments: Array<{ dueDate: string; expectedAmountMinor: number; actualAmountMinor: number | null; paidAt: string | null }> }`
  - `FinancialSnapshot.bills: BillView[]` (assembler populates; fixtures default `[]` so all Phase-2 tests pass unchanged)
  - `digitalNewsRule`, `studentLoanInterestRule`, `mortgagePrepaymentRule` — `ALL_RULES` grows 19 → 22.

- [ ] **Step 1: Extend types and fixtures**

In `src/engine/rules/types.ts`, add the `BillView` interface above `FinancialSnapshot` and add `bills: BillView[];` to `FinancialSnapshot`. In `src/engine/rules/fixtures.ts`, add `bills: []` to `makeSnapshot`'s defaults and:

```ts
import type { BillView } from "./types";

export function makeBill(overrides: Partial<BillView> = {}): BillView {
  return {
    id: nextId("bill"),
    name: "Fixture Bill",
    category: "other",
    notes: null,
    currency: "CAD",
    prepaymentMonthDay: null,
    interestRatePct: null,
    payments: [],
    ...overrides,
  };
}
```

Run `npm test` — Phase-2 suites must still pass (compile error until `makeSnapshot` gains the default — fix, don't skip).

- [ ] **Step 2: Write the failing rule tests**

Create `src/engine/rules/bill-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeBill, makeProfile, makeSnapshot } from "./fixtures";
import { digitalNewsRule, mortgagePrepaymentRule, studentLoanInterestRule } from "./bill-rules";
import { ALL_RULES } from "./index";

const profile = makeProfile();

describe("digitalNewsRule", () => {
  it("suggests the credit for news-like subscriptions, hedged", () => {
    const snapshot = makeSnapshot([], {
      bills: [makeBill({ name: "Fictional Star News", category: "subscriptions" })],
    });
    const alerts = digitalNewsRule.evaluate(profile, snapshot);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toMatch(/if .*qualif/i);
  });

  it("is silent without news-like bills", () => {
    const snapshot = makeSnapshot([], { bills: [makeBill({ name: "Fixture Gym" })] });
    expect(digitalNewsRule.evaluate(profile, snapshot)).toHaveLength(0);
  });
});

describe("studentLoanInterestRule", () => {
  it("sums this year's paid amounts on student-loan-like bills", () => {
    const snapshot = makeSnapshot([], {
      bills: [
        makeBill({
          name: "Fixture Student Loan",
          category: "debt",
          payments: [
            { dueDate: "2026-02-05", expectedAmountMinor: 20_000, actualAmountMinor: 20_000, paidAt: "2026-02-05" },
            { dueDate: "2026-03-05", expectedAmountMinor: 20_000, actualAmountMinor: 20_000, paidAt: "2026-03-05" },
            { dueDate: "2025-12-05", expectedAmountMinor: 20_000, actualAmountMinor: 20_000, paidAt: "2025-12-05" }, // prior year
          ],
        }),
      ],
    });
    const alerts = studentLoanInterestRule.evaluate(profile, snapshot);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain("$400.00"); // 2 × 200.00 this year
    expect(alerts[0].message).toMatch(/interest portion/i);
  });

  it("is silent without student-loan-like bills", () => {
    expect(studentLoanInterestRule.evaluate(profile, makeSnapshot([], { bills: [] }))).toHaveLength(0);
  });
});

describe("mortgagePrepaymentRule", () => {
  it("reminds within 60 days before the window", () => {
    const snapshot = makeSnapshot([], {
      today: "2026-05-01",
      bills: [makeBill({ name: "Fixture Mortgage", category: "housing", prepaymentMonthDay: "03-15", interestRatePct: 5 })],
    });
    const alerts = mortgagePrepaymentRule.evaluate(profile, snapshot);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain("03-15");
    expect(alerts[0].message).toContain("$500.00"); // per $10,000 at 5%
  });

  it("is silent outside the 60-day window and without the metadata", () => {
    const far = makeSnapshot([], {
      today: "2026-09-01",
      bills: [makeBill({ category: "housing", prepaymentMonthDay: "03-15" })],
    });
    expect(mortgagePrepaymentRule.evaluate(profile, far)).toHaveLength(0);
    const noMeta = makeSnapshot([], { bills: [makeBill({ category: "housing" })] });
    expect(mortgagePrepaymentRule.evaluate(profile, noMeta)).toHaveLength(0);
  });
});

describe("ALL_RULES after Phase 3", () => {
  it("has 22 uniquely-keyed rules including the bill rules", () => {
    const keys = ALL_RULES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining(["DIGITAL_NEWS", "STUDENT_LOAN_INTEREST", "MORTGAGE_PREPAYMENT"]),
    );
    expect(keys).toHaveLength(22);
  });
});
```

- [ ] **Step 3: Run to verify failure, implement**

Run `npm test` — FAIL. Create `src/engine/rules/bill-rules.ts`:

```ts
import { formatMinorUnits } from "../money";
import type { Currency } from "../money";
import type { Rule } from "./types";
import { currentYear } from "./types";

const NEWS_PATTERN = /news|globe|star|post|gazette|herald|tribune|journal/i;
const STUDENT_LOAN_PATTERN = /student|nslc|osap|loan.*student/i;

export const digitalNewsRule: Rule = {
  key: "DIGITAL_NEWS",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "ITA line 31350 — digital news subscription expenses (QCJO), up to $500",
  lastReviewed: "2026-08-14",
  evaluate(_profile, snapshot) {
    const candidates = snapshot.bills.filter(
      (b) => b.category === "subscriptions" && NEWS_PATTERN.test(`${b.name} ${b.notes ?? ""}`),
    );
    if (candidates.length === 0) return [];
    return [
      {
        ruleKey: "DIGITAL_NEWS",
        severity: "info",
        kind: "opportunity",
        entityRef: "",
        title: "Digital news subscription credit may apply",
        message: `These subscriptions look news-like: ${candidates.map((b) => b.name).join(", ")}. If any is with a Qualified Canadian Journalism Organization, line 31350 allows claiming up to $500 of the expense.`,
        action: "Check the CRA's QCJO list for your provider and keep the receipt for tax time.",
        citation: "ITA line 31350",
      },
    ];
  },
};

export const studentLoanInterestRule: Rule = {
  key: "STUDENT_LOAN_INTEREST",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "ITA line 31900 — interest on government student loans is a non-refundable credit",
  lastReviewed: "2026-08-14",
  evaluate(_profile, snapshot) {
    const year = currentYear(snapshot.today);
    const loans = snapshot.bills.filter(
      (b) => b.category === "debt" && STUDENT_LOAN_PATTERN.test(`${b.name} ${b.notes ?? ""}`),
    );
    if (loans.length === 0) return [];
    return loans.map((bill) => {
      const paidThisYear = bill.payments
        .filter((p) => p.paidAt && p.dueDate.slice(0, 4) === year)
        .reduce((sum, p) => sum + (p.actualAmountMinor ?? p.expectedAmountMinor), 0);
      return {
        ruleKey: "STUDENT_LOAN_INTEREST",
        severity: "info" as const,
        kind: "opportunity" as const,
        entityRef: bill.id,
        title: `${bill.name}: track the interest portion for tax time`,
        message: `${formatMinorUnits(paidThisYear, bill.currency as Currency)} in payments logged this year. Only the interest portion is claimable (line 31900) — the lender's annual statement shows the split, and unclaimed interest carries forward 5 years.`,
        action: "Download the annual interest statement from the lender's portal in January and give the interest figure to your tax prep.",
        citation: "ITA line 31900",
      };
    });
  },
};

export const mortgagePrepaymentRule: Rule = {
  key: "MORTGAGE_PREPAYMENT",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "Lender prepayment privilege (contract terms); rough saving = rate × amount",
  lastReviewed: "2026-08-14",
  evaluate(_profile, snapshot) {
    return snapshot.bills
      .filter((b) => b.category === "housing" && b.prepaymentMonthDay)
      .flatMap((bill) => {
        const year = currentYear(snapshot.today);
        const windowDate = `${year}-${bill.prepaymentMonthDay}`;
        const daysUntil = Math.round(
          (new Date(windowDate).getTime() - new Date(snapshot.today).getTime()) / 86_400_000,
        );
        if (daysUntil < 0 || daysUntil > 60) return [];
        const rateNote =
          bill.interestRatePct !== null
            ? ` At ${bill.interestRatePct}%, every $10,000 prepaid saves roughly ${formatMinorUnits(Math.round(1_000_000 * (bill.interestRatePct / 100)), "CAD")} of interest per year (first-year approximation).`
            : "";
        return [
          {
            ruleKey: "MORTGAGE_PREPAYMENT",
            severity: "info" as const,
            kind: "opportunity" as const,
            entityRef: bill.id,
            title: `${bill.name}: prepayment window ${bill.prepaymentMonthDay} (${daysUntil} days)`,
            message: `The annual lump-sum prepayment privilege window (${windowDate}) is ${daysUntil} day(s) away.${rateNote}`,
            action: "Decide the prepayment amount against your liquidity before the window — check the exact privilege percentage in the mortgage contract.",
            citation: "Mortgage contract prepayment terms",
          },
        ];
      });
  },
};
```

Extend `src/lib/snapshot.ts` — load bills alongside accounts and map them into `bills: BillView[]` (payments with ISO strings, `interestRatePct: b.interestRatePct === null ? null : Number(b.interestRatePct)`). Register the three rules in `src/engine/rules/index.ts` and update the registry test's expected key list (Task 9 Step 2's `ALL_RULES` test is the source of truth; also update the Phase-2 registry test's `arrayContaining` if it asserts an exhaustive length).

- [ ] **Step 4: Run all tests, commit**

Run: `npm test` — all suites pass (including untouched Phase-2 rule tests).

```bash
git add src/engine/rules/ src/lib/snapshot.ts
git commit -m "feat: add bill-dependent rules (digital news, student-loan interest, prepayment window)"
```

---

### Task 10: E2E acceptance + deploy

**OWNER CHECKPOINT** (Step 3 onward).

**Files:**
- Create: `e2e/fixtures/bills-sample.json`, `e2e/bills.spec.ts`

- [ ] **Step 1: Fixture** — entirely fictional; the biweekly anchor is chosen so April and September 2026 are the triple months:

Create `e2e/fixtures/bills-sample.json`:

```json
{
  "accounts": [],
  "bills": [
    {
      "name": "Fixture Mortgage",
      "category": "housing",
      "payee": "Fixture Bank",
      "autopay": true,
      "prepaymentMonthDay": "03-15",
      "interestRatePct": 5,
      "cadence": { "type": "BIWEEKLY", "anchor": "2026-01-07" },
      "schedule": [{ "from": "2020-01-01", "amountMinor": 100000 }]
    },
    {
      "name": "Fixture Condo Fees",
      "category": "housing",
      "autopay": true,
      "cadence": { "type": "MONTHLY", "dayOfMonth": 1 },
      "schedule": [
        { "from": "2020-01-01", "to": "2026-07-31", "amountMinor": 40000 },
        { "from": "2026-08-01", "amountMinor": 42000 }
      ]
    },
    {
      "name": "Fixture Stream Bundle",
      "category": "subscriptions",
      "autopay": true,
      "cadence": { "type": "MONTHLY", "dayOfMonth": 1 },
      "schedule": [
        { "from": "2025-09-01", "to": "2026-08-31", "amountMinor": 1000 },
        { "from": "2026-09-01", "amountMinor": 1500 }
      ]
    },
    {
      "name": "Fixture Water",
      "category": "utilities",
      "variable": true,
      "cadence": { "type": "QUARTERLY", "anchor": "2026-09-30" },
      "schedule": [{ "from": "2020-01-01", "amountMinor": 25000 }]
    }
  ]
}
```

- [ ] **Step 2: E2E spec**

Create `e2e/bills.spec.ts`:

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

test("bills end to end", async ({ browser, baseURL }) => {
  const context = await createAuthedContext(browser, baseURL!);
  const page = await context.newPage();

  // Import the fictional bill set
  await page.goto("/investments/import");
  await page
    .locator('input[name="file"]')
    .setInputFiles(path.join(__dirname, "fixtures", "bills-sample.json"));
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText(/4 bills/)).toBeVisible();

  // Grouped list with next due dates
  await page.goto("/bills");
  for (const name of ["Fixture Mortgage", "Fixture Condo Fees", "Fixture Stream Bundle", "Fixture Water"]) {
    await expect(page.getByText(name)).toBeVisible();
  }

  // September 2026 month view: triple mortgage + stepped amounts, hand-checked total
  await page.goto("/bills/month?month=2026-09");
  await expect(page.getByTestId("pileup-flag")).toContainText("3× Fixture Mortgage");
  // 3×1000.00 + condo 420.00 + stream 15.00 + water 250.00 = 3685.00
  await expect(page.getByText("Total: $3,685.00")).toBeVisible();

  // Forecast table flags the triple months
  await page.goto("/bills/forecast");
  await expect(page.getByText("3× Fixture Mortgage").first()).toBeVisible();

  // Mark a mortgage occurrence paid and see it reflected
  await page.goto("/bills");
  await page.getByText("Fixture Mortgage").click();
  await page.getByRole("button", { name: "mark paid" }).first().click();
  await expect(page.getByText("paid").first()).toBeVisible();

  // Dashboard strip shows something due in the next 14 days (biweekly guarantees it)
  await page.goto("/");
  await expect(page.getByText("Next 14 days")).toBeVisible();
  await expect(page.getByText("Fixture Mortgage").first()).toBeVisible();

  await context.close();
});
```

Before running: in `playwright.config.ts`, add `workers: 1` at the top level of the config (next to `testDir`). All E2E spec files share the single seeded test user (`e2e-test@example.com`) and clean it up in `beforeAll`/`afterAll` — parallel workers would tear down each other's data mid-test. Serial execution is the correct tradeoff for a personal app's suite; if it was already added during Phase 2, skip this.

Run: `npm run e2e` — all specs (smoke + investments + money-finder + bills) pass. Then the full gate: `npm test && npm run lint && npm run build && npm run e2e`.

```bash
git add e2e/ playwright.config.ts
git commit -m "test: add bills E2E acceptance flow and serialize E2E workers"
```

- [ ] **Step 3: OWNER CHECKPOINT — pre-push audit and push**

Audit `git diff origin/main..HEAD` for personal tokens (fixtures contain only "Fixture …" names). Ask the owner, then `git push origin main`.

- [ ] **Step 4: OWNER CHECKPOINT — real bills import**

The owner's real bills live in a seed file kept outside the repo (dollar amounts, vault-placeholder identifiers). Offer to convert it locally into `docs/private/bills-import.json` (cents, import format, identifiers dropped entirely — the app never needs them), collecting the still-missing inputs from `docs/private/owner-context.md`: **the mortgage biweekly anchor date** (any one known payment Wednesday — the forecast is wrong without it), the prepayment window month-day and mortgage rate if the owner wants the reminder rule. The owner then imports on production and verifies: the bill list matches reality, the next triple-mortgage month shows flagged with the right total, and the 14-day strip is accurate.

- [ ] **Step 5: Mark Phase 3 done**

All checkboxes checked; spec Phase 3 row satisfied (recurrence engine, bill CRUD, month view, 12-month forecast with pileup flags, mark-as-paid) plus the three deferred rules. Remaining for Phase 4: Cards. Phase 5 picks up CSV import, tax-season checklist, FX auto-fetch, danger-month detector.

---

## Self-review notes

- **Spec coverage (Phase 3 row + §4 patterns):** effective-dated schedule ✔ (engine + UI schedule management), biweekly-from-anchor with 26/yr + triple months ✔ (hand-verified against the 2026 calendar: anchor Wed 2026-01-07 → Apr 1/15/29 and Sep 2/16/30), month view with running total + pileup highlight ✔, 12-month forecast with cumulative ✔, mark-as-paid actuals with estimate-vs-actual ✔, 14-day dashboard strip with autopay badges ✔, property-tax pattern (activeMonths + startsFrom: 11 instalments Feb–Dec, nothing before) ✔ tested, bounded windows ✔. Deferred rules 16/18/19 now shipped ✔ (ALL_RULES 19 → 22, Phase-2 tests untouched via fixture default `bills: []`).
- **Hand-checked arithmetic:** Jan 2026 total 2×100000+40000 = 240,000 ✔; Apr 3×100000+40000 = 340,000 ✔; Sep 3×100000+42000 = 342,000 ✔ (condo increase applied); E2E Sep total 300,000+42,000+1,500+25,000 = 368,500 → $3,685.00 ✔; student-loan 2×20,000 = 40,000 → $400.00 ✔; prepayment per-$10k at 5% = $500.00 ✔; quarterly clamp Nov 30 → Feb 28 ✔ (2027 not a leap year).
- **Type consistency:** `Cadence`/`ScheduleEntry` defined once in recurrence.ts and imported everywhere (validation mirrors, engine owns); `BillDef` mapping helper repeated in three pages (deliberate — small, and pages stay self-contained); `markPaid` derives `expectedAmountMinor` from `amountOn` at the due date, so estimate-vs-actual is stable even if the schedule changes later.
- **Known risks stated:** forecast totals assume single-currency (CAD-dominant) bills — documented in Task 3 Interfaces; heuristic name-matching in the three bill rules uses hedged language; the E2E month-view assertion is date-independent (targets 2026-09 explicitly) but the "mark paid" and dashboard-strip steps depend on the real clock only through the biweekly cadence, which always has an occurrence within 14 days.
