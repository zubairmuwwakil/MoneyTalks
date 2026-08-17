# MoneyTalks Phase 5 (Polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The final spec phase — CSV transaction import with idempotent dedupe, the card statement analyzer ("you left $X on the table"), Bank of Canada FX auto-fetch, best-effort price auto-fetch, the danger-month detector, the January tax-season checklist, and PWA tuning.

**Architecture:** New pure engines (`csv`, `cards/analyzer`, `dangermonth`, `taxchecklist`) with the same TDD discipline; the app's **first outbound network calls** (three named public APIs, nothing personal sent beyond tickers/series codes) isolated in `src/lib/fetch-*.ts` wrappers whose parsers are pure and fixture-tested. Every fetch failure is non-fatal — manual entry always works and the stale-data rule already nags.

**Tech Stack:** No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-14-moneytalks-design.md`

**Prerequisite:** Phases 0–4 complete locally. NOTE: Phase 4's push + real-wallet import checkpoints may still be pending — confirm with the owner before starting; production must be current before this phase's final checkpoint.

## Global Constraints

All Phase 0–4 Global Constraints apply, including the two Phase-4 amendments (owner is sole commit author — **no Co-Authored-By/AI trailers**; the fixture trap — every fixture value invented, never transcribed; re-confirm with the owner before the first push). Phase-5 additions:

- **Outbound calls are limited to three named public endpoints:** Bank of Canada Valet (FX), Stooq (equity quotes), CoinGecko (crypto prices). Requests carry only series codes / ticker symbols — never balances, names, or identifiers. No other hosts.
- **CSV files are never persisted raw.** They are parsed in memory; only validated, deduped rows reach the database. The upload page says so.
- Dedupe hash = stable hash of `(accountId, date, amountMinor, description)` — re-importing any overlapping CSV must create zero duplicates and report the skip count.
- Settings money inputs follow the **existing dollar-input pattern** in `src/lib/validation/profile.ts` (dollars in the form, integer cents in storage) — match it exactly for the new cushion field.

---

### Task 1: CSV engine — parser, mapping, dedupe hash

**Files:**
- Create: `src/engine/csv.ts`, `src/engine/csv.test.ts`

**Interfaces:**
- Produces:
  - `parseCsv(text: string): string[][]` — handles quoted fields, embedded commas, `""` escapes, CRLF; throws `RangeError` over 10,000 rows.
  - `interface ColumnMapping { dateCol: number; amountCol: number; descriptionCol: number; dateFormat: "YMD" | "MDY" | "DMY"; negate: boolean; hasHeader: boolean }`
  - `mapRows(rows: string[][], mapping: ColumnMapping): Array<{ date: string; amountMinor: number; description: string } | { error: string; rowIndex: number }>` — dollars→integer cents (handles `$`, `1,234.56`, `(45.00)` as negative), dates→ISO.
  - `dedupeHash(accountId: string, date: string, amountMinor: number, description: string): string` — djb2 hex, stable.

- [ ] **Step 1: Write the failing test**

Create `src/engine/csv.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dedupeHash, mapRows, parseCsv, type ColumnMapping } from "./csv";

describe("parseCsv", () => {
  it("parses quoted fields with embedded commas and escaped quotes", () => {
    const rows = parseCsv('date,desc,amt\r\n2026-01-05,"COFFEE, THE ""GOOD"" ONE",4.50\n');
    expect(rows).toEqual([
      ["date", "desc", "amt"],
      ["2026-01-05", 'COFFEE, THE "GOOD" ONE', "4.50"],
    ]);
  });

  it("skips blank lines", () => {
    expect(parseCsv("a,b\n\n1,2\n")).toHaveLength(2);
  });
});

describe("mapRows", () => {
  const mapping: ColumnMapping = {
    dateCol: 0, amountCol: 2, descriptionCol: 1, dateFormat: "MDY", negate: false, hasHeader: true,
  };

  it("maps columns, converts dollars to cents, and normalizes dates", () => {
    const out = mapRows(
      [
        ["Date", "Description", "Amount"],
        ["01/05/2026", "FIXTURE GROCER", "$1,234.56"],
        ["02/07/2026", "FIXTURE REFUND", "(45.00)"],
      ],
      mapping,
    );
    expect(out).toEqual([
      { date: "2026-01-05", amountMinor: 123_456, description: "FIXTURE GROCER" },
      { date: "2026-02-07", amountMinor: -4_500, description: "FIXTURE REFUND" },
    ]);
  });

  it("negates when the statement's sign convention is inverted", () => {
    const out = mapRows([["01/05/2026", "X", "10.00"]], { ...mapping, hasHeader: false, negate: true });
    expect(out).toEqual([{ date: "2026-01-05", amountMinor: -1_000, description: "X" }]);
  });

  it("reports unparseable rows as errors instead of throwing", () => {
    const out = mapRows([["not-a-date", "X", "abc"]], { ...mapping, hasHeader: false });
    expect(out[0]).toMatchObject({ rowIndex: 0 });
    expect("error" in out[0]).toBe(true);
  });
});

describe("dedupeHash", () => {
  it("is stable and input-sensitive", () => {
    const a = dedupeHash("acct1", "2026-01-05", 123456, "FIXTURE GROCER");
    expect(a).toBe(dedupeHash("acct1", "2026-01-05", 123456, "FIXTURE GROCER"));
    expect(a).not.toBe(dedupeHash("acct1", "2026-01-05", 123457, "FIXTURE GROCER"));
    expect(a).not.toBe(dedupeHash("acct2", "2026-01-05", 123456, "FIXTURE GROCER"));
  });
});
```

- [ ] **Step 2: Run to verify failure, implement**

Run: `npm test` — FAIL. Create `src/engine/csv.ts`:

```ts
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      if (rows.length > 10_000) throw new RangeError("CSV exceeds 10,000 rows");
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

export interface ColumnMapping {
  dateCol: number;
  amountCol: number;
  descriptionCol: number;
  dateFormat: "YMD" | "MDY" | "DMY";
  negate: boolean;
  hasHeader: boolean;
}

function parseDate(raw: string, format: "YMD" | "MDY" | "DMY"): string | null {
  const parts = raw.trim().split(/[/\-.]/).map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isInteger(p))) return null;
  const [a, b, c] = parts;
  const [y, m, d] =
    format === "YMD" ? [a, b, c] : format === "MDY" ? [c, a, b] : [c, b, a];
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseAmountMinor(raw: string): number | null {
  let s = raw.trim().replace(/[$,\s]/g, "");
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [dollars, cents = ""] = s.split(".");
  const minor = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}

export type MappedRow =
  | { date: string; amountMinor: number; description: string }
  | { error: string; rowIndex: number };

export function mapRows(rows: string[][], mapping: ColumnMapping): MappedRow[] {
  const body = mapping.hasHeader ? rows.slice(1) : rows;
  return body.map((cells, rowIndex) => {
    const date = parseDate(cells[mapping.dateCol] ?? "", mapping.dateFormat);
    const amount = parseAmountMinor(cells[mapping.amountCol] ?? "");
    const description = (cells[mapping.descriptionCol] ?? "").trim();
    if (date === null || amount === null) {
      return { error: `row ${rowIndex}: bad ${date === null ? "date" : "amount"}`, rowIndex };
    }
    return { date, amountMinor: mapping.negate ? -amount : amount, description };
  });
}

export function dedupeHash(
  accountId: string,
  date: string,
  amountMinor: number,
  description: string,
): string {
  const input = `${accountId}|${date}|${amountMinor}|${description}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}
```

Run: `npm test` — expect pass.

- [ ] **Step 3: Commit**

```bash
git add src/engine/csv.*
git commit -m "feat: add CSV engine with mapping and dedupe hashing"
```

---

### Task 2: Transactions CSV import UI

**Files:**
- Create: `src/app/investments/[id]/csv/page.tsx`, `src/app/investments/[id]/csv/actions.ts`

**Interfaces:**
- Consumes: CSV engine, `prisma`, `requireUserId`.
- Produces: `/investments/[id]/csv` — upload → column-mapping form (column indexes, date format, sign convention, positive/negative type mapping) → preview table of the first 10 mapped rows + error rows → import. Inserts only rows whose `dedupeHash` is absent for that account; result reports `imported` / `skippedDuplicates` / `errors`. A "Import CSV" link is added on the account detail page header.

- [ ] **Step 1: Implement the action**

Create `src/app/investments/[id]/csv/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { dedupeHash, mapRows, parseCsv, type ColumnMapping } from "@/engine/csv";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export interface CsvImportResult {
  ok: boolean;
  error?: string;
  imported?: number;
  skippedDuplicates?: number;
  errors?: number;
}

export async function importCsv(formData: FormData): Promise<CsvImportResult> {
  const userId = await requireUserId();
  const accountId = String(formData.get("accountId") ?? "");
  const account = await prisma.financialAccount.findFirst({ where: { id: accountId, userId } });
  if (!account) return { ok: false, error: "Account not found" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file uploaded" };

  const mapping: ColumnMapping = {
    dateCol: Number(formData.get("dateCol")),
    amountCol: Number(formData.get("amountCol")),
    descriptionCol: Number(formData.get("descriptionCol")),
    dateFormat: String(formData.get("dateFormat")) as ColumnMapping["dateFormat"],
    negate: formData.get("negate") === "true",
    hasHeader: formData.get("hasHeader") === "true",
  };
  const positiveType = String(formData.get("positiveType") ?? "CONTRIBUTION");
  const negativeType = String(formData.get("negativeType") ?? "WITHDRAWAL");
  const VALID = ["CONTRIBUTION", "WITHDRAWAL", "BUY", "SELL", "DIVIDEND", "INTEREST", "FEE"];
  if (!VALID.includes(positiveType) || !VALID.includes(negativeType)) {
    return { ok: false, error: "Bad type mapping" };
  }

  let rows;
  try {
    rows = mapRows(parseCsv(await file.text()), mapping);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Parse failed" };
  }

  const existing = new Set(
    (
      await prisma.transaction.findMany({
        where: { accountId, dedupeHash: { not: null } },
        select: { dedupeHash: true },
      })
    ).map((t) => t.dedupeHash),
  );

  let imported = 0;
  let skippedDuplicates = 0;
  let errors = 0;

  for (const row of rows) {
    if ("error" in row) {
      errors += 1;
      continue;
    }
    const hash = dedupeHash(accountId, row.date, row.amountMinor, row.description);
    if (existing.has(hash)) {
      skippedDuplicates += 1;
      continue;
    }
    existing.add(hash);
    await prisma.transaction.create({
      data: {
        accountId,
        type: (row.amountMinor >= 0 ? positiveType : negativeType) as never,
        amountMinor: Math.abs(row.amountMinor),
        currency: account.currency,
        date: new Date(row.date),
        description: row.description || undefined,
        dedupeHash: hash,
      },
    });
    imported += 1;
  }

  revalidatePath(`/investments/${accountId}`);
  revalidatePath("/");
  return { ok: true, imported, skippedDuplicates, errors };
}
```

- [ ] **Step 2: Implement the page**

Create `src/app/investments/[id]/csv/page.tsx` (server page, plain form — mapping fields with sensible defaults, result via redirect params):

```tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { importCsv } from "./actions";

const TYPES = ["CONTRIBUTION", "WITHDRAWAL", "BUY", "SELL", "DIVIDEND", "INTEREST", "FEE"];
const input = "mt-1 w-full rounded border px-2 py-1 text-sm";

export default async function CsvImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const userId = await requireUserId();
  const { id } = await params;
  const { done, error } = await searchParams;
  const account = await prisma.financialAccount.findFirst({ where: { id, userId } });
  if (!account) notFound();

  async function submit(formData: FormData) {
    "use server";
    const result = await importCsv(formData);
    if (result.ok) {
      redirect(
        `/investments/${formData.get("accountId")}/csv?done=${result.imported} imported, ${result.skippedDuplicates} duplicates skipped, ${result.errors} error rows`,
      );
    }
    redirect(`/investments/${formData.get("accountId")}/csv?error=${encodeURIComponent(result.error ?? "failed")}`);
  }

  return (
    <main className="max-w-xl space-y-4 py-8">
      <h1 className="text-xl font-semibold">CSV import — {account.name}</h1>
      <p className="text-sm text-muted-foreground">
        The file is parsed in memory and never stored; only validated rows become transactions.
        Re-importing an overlapping file is safe — duplicates are skipped by content hash.
      </p>
      {done ? <p className="text-sm text-green-700">{done}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <form action={submit} className="space-y-3">
        <input type="hidden" name="accountId" value={account.id} />
        <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
        <div className="grid grid-cols-3 gap-3 text-sm">
          <label>Date column #<input name="dateCol" defaultValue={0} className={input} /></label>
          <label>Description column #<input name="descriptionCol" defaultValue={1} className={input} /></label>
          <label>Amount column #<input name="amountCol" defaultValue={2} className={input} /></label>
          <label>Date format
            <select name="dateFormat" className={input}>
              <option value="YMD">YYYY-MM-DD</option>
              <option value="MDY">MM/DD/YYYY</option>
              <option value="DMY">DD/MM/YYYY</option>
            </select>
          </label>
          <label>Positive amounts are
            <select name="positiveType" className={input}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>Negative amounts are
            <select name="negativeType" defaultValue="WITHDRAWAL" className={input}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="hasHeader" value="true" defaultChecked /> First row is a header
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="negate" value="true" /> Flip signs (statement shows spending as positive)
        </label>
        <button type="submit" className="rounded bg-foreground px-4 py-2 text-sm text-background">Import</button>
      </form>
      <Link href={`/investments/${account.id}`} className="text-sm underline">← back to account</Link>
    </main>
  );
}
```

Add next to the account header in `src/app/investments/[id]/page.tsx`: `<Link href={`/investments/${account.id}/csv`} className="text-sm underline">Import CSV</Link>`.

- [ ] **Step 3: Verify + commit**

Run: `npm run dev` — import a small hand-made fictional CSV twice; second run reports all duplicates skipped. `npm test && npm run lint && npm run build`.

```bash
git add src/app/investments/
git commit -m "feat: add per-account CSV transaction import with dedupe"
```

---

### Task 3: Statement analyzer — "what you left on the table"

**Files:**
- Create: `src/engine/cards/analyzer.ts`, `src/engine/cards/analyzer.test.ts`, `src/app/cards/analyzer/page.tsx`, `src/app/cards/analyzer/actions.ts`

**Interfaces:**
- Consumes: CSV engine, picker engine, merchants, fixtures.
- Produces:
  - `categorize(description: string): SpendCategory` — merchant match first, then keyword heuristics, else `everything_else`.
  - `analyzeStatement(spend: Array<{ date: string; amountMinor: number; description: string }>, usedCard: CardDef, wallet: CardDef[], today: string): { totalSpendMinor: number; earnedMinor: number; optimalMinor: number; missedMinor: number; byCategory: Array<{ category: SpendCategory; spendMinor: number; earnedMinor: number; optimalMinor: number; bestCardNickname: string | null }> }` — negative rows (refunds) excluded; earned/optimal use the domestic, Amex-accepted context.
  - `/cards/analyzer` — pick the card the statement belongs to, upload CSV (same mapping controls), get the report; a "suggested rewards estimate" line offers the earned figure for the card's ROI meter.

- [ ] **Step 1: Write the failing test**

Create `src/engine/cards/analyzer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { analyzeStatement, categorize } from "./analyzer";
import { FIXTURE_CARDS } from "./fixtures";

const [alpha, beta] = FIXTURE_CARDS;

describe("categorize", () => {
  it("uses merchant facts first", () => {
    expect(categorize("NO FRILLS #123")).toBe("groceries");
    expect(categorize("TIM HORTONS 456")).toBe("dining");
  });

  it("falls back to keywords, then everything_else", () => {
    expect(categorize("SUPERMARKET PLAZA")).toBe("groceries");
    expect(categorize("PIZZA PALACE")).toBe("dining");
    expect(categorize("MYSTERY VENDOR")).toBe("everything_else");
  });
});

describe("analyzeStatement", () => {
  const spend = [
    { date: "2026-08-01", amountMinor: 100_000, description: "SUPERMARKET PLAZA" }, // groceries
    { date: "2026-08-02", amountMinor: 50_000, description: "PIZZA PALACE" }, // dining
    { date: "2026-08-03", amountMinor: -10_000, description: "REFUND" }, // excluded
    { date: "2026-08-04", amountMinor: 20_000, description: "MYSTERY VENDOR" }, // everything_else
  ];

  it("computes earned vs optimal on the Beta card", () => {
    const report = analyzeStatement(spend, beta, FIXTURE_CARDS, "2026-08-15");
    expect(report.totalSpendMinor).toBe(170_000);
    // Beta earns: groceries 3% of 1000 = 3000; dining base 1.5% of 500 = 750; misc 1.5% of 200 = 300 → 4050
    expect(report.earnedMinor).toBe(4_050);
    // Optimal: groceries Alpha 4.8% = 4800; dining Alpha 6% = 3000; misc Gamma 2% = 400 → 8200
    expect(report.optimalMinor).toBe(8_200);
    expect(report.missedMinor).toBe(4_150);
    const groceries = report.byCategory.find((c) => c.category === "groceries");
    expect(groceries?.bestCardNickname).toBe("Fixture Alpha Amex");
  });

  it("reports zero missed when the used card is optimal everywhere", () => {
    const diningOnly = [{ date: "2026-08-02", amountMinor: 50_000, description: "PIZZA PALACE" }];
    const report = analyzeStatement(diningOnly, alpha, FIXTURE_CARDS, "2026-08-15");
    expect(report.missedMinor).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure, implement**

Run: `npm test` — FAIL. Create `src/engine/cards/analyzer.ts`:

```ts
import { matchMerchant } from "./merchants";
import { effectiveReturnPct, recommend, type PurchaseCtx } from "./picker";
import type { CardDef, SpendCategory } from "./types";

const KEYWORDS: Array<[RegExp, SpendCategory]> = [
  [/supermarket|grocer|food mart|market/i, "groceries"],
  [/restaurant|pizza|sushi|coffee|cafe|burger|doordash|skip.?the.?dishes/i, "dining"],
  [/gas|petro|fuel|esso|shell/i, "gas"],
  [/netflix|spotify|disney|crave|prime video/i, "streaming"],
  [/hydro|utility|telecom|mobile|internet|insurance/i, "bills"],
  [/hotel|inn|resort/i, "hotel"],
  [/airline|air |flight|rail/i, "travel"],
];

export function categorize(description: string): SpendCategory {
  const merchant = matchMerchant(description)[0] ?? null;
  if (merchant) return merchant.category;
  for (const [pattern, category] of KEYWORDS) {
    if (pattern.test(description)) return category;
  }
  return "everything_else";
}

function ctxFor(category: SpendCategory, today: string): PurchaseCtx {
  return { category, amexAccepted: true, foreign: false, networkRestriction: null, today };
}

export function analyzeStatement(
  spend: Array<{ date: string; amountMinor: number; description: string }>,
  usedCard: CardDef,
  wallet: CardDef[],
  today: string,
) {
  const byCategory = new Map<SpendCategory, number>();
  for (const row of spend) {
    if (row.amountMinor <= 0) continue; // refunds/credits
    const category = categorize(row.description);
    byCategory.set(category, (byCategory.get(category) ?? 0) + row.amountMinor);
  }

  let totalSpendMinor = 0;
  let earnedMinor = 0;
  let optimalMinor = 0;
  const rows = [...byCategory.entries()].map(([category, spendMinor]) => {
    const ctx = ctxFor(category, today);
    const usedPct = effectiveReturnPct(usedCard, ctx, [])?.pct ?? 0;
    const best = recommend(wallet, ctx, []).best;
    const bestPct = best?.pct ?? 0;
    const earned = Math.round((spendMinor * usedPct) / 100);
    const optimal = Math.round((spendMinor * Math.max(bestPct, usedPct)) / 100);
    totalSpendMinor += spendMinor;
    earnedMinor += earned;
    optimalMinor += optimal;
    return {
      category,
      spendMinor,
      earnedMinor: earned,
      optimalMinor: optimal,
      bestCardNickname: best?.nickname ?? null,
    };
  });

  return {
    totalSpendMinor,
    earnedMinor,
    optimalMinor,
    missedMinor: optimalMinor - earnedMinor,
    byCategory: rows.sort((a, b) => b.spendMinor - a.spendMinor),
  };
}
```

Run: `npm test` — expect pass (hand-check in the test comments).

- [ ] **Step 3: Analyzer page**

Create `src/app/cards/analyzer/actions.ts`:

```ts
"use server";

import { analyzeStatement } from "@/engine/cards/analyzer";
import { mapRows, parseCsv, type ColumnMapping } from "@/engine/csv";
import type { CardDef, CardRewards } from "@/engine/cards/types";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export type AnalyzeResult =
  | { ok: false; error: string }
  | { ok: true; report: ReturnType<typeof analyzeStatement>; cardNickname: string };

export async function analyzeCsv(formData: FormData): Promise<AnalyzeResult> {
  const userId = await requireUserId();
  const cardId = String(formData.get("cardId") ?? "");
  const cards = await prisma.creditCard.findMany({ where: { userId } });
  const used = cards.find((c) => c.id === cardId);
  if (!used) return { ok: false, error: "Card not found" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file uploaded" };

  const mapping: ColumnMapping = {
    dateCol: Number(formData.get("dateCol")),
    amountCol: Number(formData.get("amountCol")),
    descriptionCol: Number(formData.get("descriptionCol")),
    dateFormat: String(formData.get("dateFormat")) as ColumnMapping["dateFormat"],
    negate: formData.get("negate") === "true",
    hasHeader: formData.get("hasHeader") === "true",
  };

  let rows;
  try {
    rows = mapRows(parseCsv(await file.text()), mapping);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Parse failed" };
  }
  const spend = rows.filter((r): r is Exclude<typeof r, { error: string; rowIndex: number }> => !("error" in r));

  const defs: CardDef[] = cards.map((c) => ({
    id: c.id,
    nickname: c.nickname,
    network: c.network as CardDef["network"],
    annualFeeMinor: c.annualFeeMinor,
    rewards: c.rewards as unknown as CardRewards,
  }));
  const usedDef = defs.find((d) => d.id === cardId)!;
  const report = analyzeStatement(spend, usedDef, defs, new Date().toISOString().slice(0, 10));
  return { ok: true, report, cardNickname: used.nickname };
}
```

Create `src/app/cards/analyzer/page.tsx` — a client page (the report renders without a redirect round-trip):

```tsx
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { AnalyzerForm } from "./form";

export default async function AnalyzerPage() {
  const userId = await requireUserId();
  const cards = await prisma.creditCard.findMany({
    where: { userId },
    select: { id: true, nickname: true },
    orderBy: { nickname: "asc" },
  });
  return (
    <main className="max-w-2xl space-y-4 py-8">
      <h1 className="text-xl font-semibold">Statement analyzer</h1>
      <p className="text-sm text-muted-foreground">
        Upload one card&apos;s statement CSV. It is analyzed in memory and never stored. The report
        shows what the spend earned vs what the wallet&apos;s best cards would have earned.
      </p>
      <AnalyzerForm cards={cards} />
    </main>
  );
}
```

Create `src/app/cards/analyzer/form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { CATEGORY_LABELS } from "@/engine/cards/types";
import { analyzeCsv, type AnalyzeResult } from "./actions";

const input = "mt-1 w-full rounded border px-2 py-1 text-sm";

export function AnalyzerForm({ cards }: { cards: Array<{ id: string; nickname: string }> }) {
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const fmt = (minor: number) => `$${(minor / 100).toLocaleString("en-CA", { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      <form
        action={async (formData: FormData) => {
          setResult(await analyzeCsv(formData));
        }}
        className="space-y-3"
      >
        <label className="block text-sm">Statement belongs to
          <select name="cardId" className={input}>
            {cards.map((c) => <option key={c.id} value={c.id}>{c.nickname}</option>)}
          </select>
        </label>
        <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
        <div className="grid grid-cols-3 gap-3 text-sm">
          <label>Date col #<input name="dateCol" defaultValue={0} className={input} /></label>
          <label>Desc col #<input name="descriptionCol" defaultValue={1} className={input} /></label>
          <label>Amount col #<input name="amountCol" defaultValue={2} className={input} /></label>
        </div>
        <div className="flex gap-4 text-sm">
          <label>Date format{" "}
            <select name="dateFormat" className="rounded border px-2 py-1">
              <option value="MDY">MM/DD/YYYY</option>
              <option value="YMD">YYYY-MM-DD</option>
              <option value="DMY">DD/MM/YYYY</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="hasHeader" value="true" defaultChecked /> Header row
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="negate" value="true" /> Flip signs
          </label>
        </div>
        <button type="submit" className="rounded bg-foreground px-4 py-2 text-sm text-background">Analyze</button>
      </form>

      {result && !result.ok ? <p className="text-sm text-red-600">{result.error}</p> : null}
      {result?.ok ? (
        <section className="space-y-3" data-testid="analyzer-report">
          <p className="text-lg font-semibold">
            You left {fmt(result.report.missedMinor)} on the table
          </p>
          <p className="text-sm text-muted-foreground">
            {fmt(result.report.totalSpendMinor)} spend on {result.cardNickname} earned{" "}
            {fmt(result.report.earnedMinor)}; the wallet&apos;s best cards would have earned {fmt(result.report.optimalMinor)}.
            Suggested ROI-meter estimate for this card: {fmt(result.report.earnedMinor)}.
          </p>
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1">Category</th><th>Spend</th><th>Earned</th><th>Optimal</th><th>Use instead</th>
              </tr>
            </thead>
            <tbody>
              {result.report.byCategory.map((row) => (
                <tr key={row.category} className="border-b">
                  <td className="py-1">{CATEGORY_LABELS[row.category]}</td>
                  <td>{fmt(row.spendMinor)}</td>
                  <td>{fmt(row.earnedMinor)}</td>
                  <td>{fmt(row.optimalMinor)}</td>
                  <td>{row.bestCardNickname ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
```

Add an "Analyzer" link beside "Manage" on `/cards`.

- [ ] **Step 4: Verify + commit**

Run: `npm run dev` — analyze a fictional CSV against a fixture card; report matches hand math. `npm test && npm run lint && npm run build`.

```bash
git add src/engine/cards/analyzer.* src/app/cards/
git commit -m "feat: add statement analyzer with missed-rewards report"
```

---

### Task 4: FX auto-fetch (Bank of Canada Valet)

**Files:**
- Create: `src/lib/fetch-fx.ts`, `src/lib/fetch-fx.test.ts`, `src/app/actions/refresh.ts`
- Modify: `src/app/page.tsx` (refresh button)

**Interfaces:**
- Produces: `parseValetObservation(json: unknown, series: string): { rate: number; asOf: string } | null` (pure, fixture-tested); `fetchUsdCadRate(): Promise<{ rate: number; asOf: string } | null>` (network wrapper, `https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1`, 5s timeout, null on any failure); server action `refreshFxRates` upserting the USD→CAD `FxRate` row. JMD has no Valet series — stays manual (documented on the dashboard tooltip).

- [ ] **Step 1: Failing parser test**

Create `src/lib/fetch-fx.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseValetObservation } from "./fetch-fx";

const fixture = {
  observations: [{ d: "2026-08-14", FXUSDCAD: { v: "1.3701" } }],
};

describe("parseValetObservation", () => {
  it("extracts the rate and date", () => {
    expect(parseValetObservation(fixture, "FXUSDCAD")).toEqual({ rate: 1.3701, asOf: "2026-08-14" });
  });

  it("returns null on malformed payloads", () => {
    expect(parseValetObservation({}, "FXUSDCAD")).toBeNull();
    expect(parseValetObservation({ observations: [] }, "FXUSDCAD")).toBeNull();
    expect(parseValetObservation({ observations: [{ d: "x", FXUSDCAD: { v: "abc" } }] }, "FXUSDCAD")).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

Create `src/lib/fetch-fx.ts`:

```ts
export function parseValetObservation(
  json: unknown,
  series: string,
): { rate: number; asOf: string } | null {
  if (typeof json !== "object" || json === null) return null;
  const observations = (json as { observations?: unknown }).observations;
  if (!Array.isArray(observations) || observations.length === 0) return null;
  const latest = observations[observations.length - 1] as Record<string, unknown>;
  const d = latest.d;
  const cell = latest[series] as { v?: unknown } | undefined;
  const rate = Number(cell?.v);
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(rate) || rate <= 0) {
    return null;
  }
  return { rate, asOf: d };
}

export async function fetchUsdCadRate(): Promise<{ rate: number; asOf: string } | null> {
  try {
    const res = await fetch(
      "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1",
      { signal: AbortSignal.timeout(5000), cache: "no-store" },
    );
    if (!res.ok) return null;
    return parseValetObservation(await res.json(), "FXUSDCAD");
  } catch {
    return null;
  }
}
```

Create `src/app/actions/refresh.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { fetchUsdCadRate } from "@/lib/fetch-fx";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export async function refreshFxRates(): Promise<void> {
  const userId = await requireUserId();
  const result = await fetchUsdCadRate();
  if (!result) return; // silent no-op; stale-data rule keeps nagging
  await prisma.fxRate.upsert({
    where: {
      userId_base_quote_asOf: { userId, base: "USD", quote: "CAD", asOf: new Date(result.asOf) },
    },
    update: { rate: result.rate },
    create: { userId, base: "USD", quote: "CAD", rate: result.rate, asOf: new Date(result.asOf) },
  });
  revalidatePath("/");
  revalidatePath("/money-finder");
}
```

In `src/app/page.tsx`, next to the currency toggle add:

```tsx
        <form action={refreshFxRates}>
          <button type="submit" className="rounded border px-2 py-1 text-xs" title="USD/CAD from Bank of Canada Valet (JMD stays manual)">
            ↻ FX
          </button>
        </form>
```

- [ ] **Step 3: Verify + commit**

Run: `npm test` (parser green); `npm run dev` and click ↻ FX — a fresh USD→CAD rate row appears (visible via converted totals / stale-data alert clearing). `npm run lint && npm run build`.

```bash
git add src/lib/fetch-fx.* src/app/actions/ src/app/page.tsx
git commit -m "feat: add Bank of Canada FX auto-fetch"
```

---

### Task 5: Price auto-fetch (best-effort)

**Files:**
- Create: `src/lib/fetch-prices.ts`, `src/lib/fetch-prices.test.ts`
- Modify: `src/app/actions/refresh.ts` (add `refreshPrices`), `src/app/investments/[id]/page.tsx` (button)

**Interfaces:**
- Produces: `parseStooqCsv(csv: string): number | null` (close price → minor units); `COINGECKO_IDS: Record<string, string>` (small symbol→id map: BTC, ETH, SOL, ADA, DOGE, LTC, XRP); `parseCoinGecko(json: unknown, id: string, vs: string): number | null`; network wrappers with 5s timeouts returning null on failure; server action `refreshPrices(accountId)` — updates each holding's `lastPriceMinor` + `priceAsOf` when a source succeeds, reports `{ updated, failed }` via redirect param. Equities try `SYMBOL` then `SYMBOL.US` on Stooq; crypto uses CoinGecko in the account's currency.

- [ ] **Step 1: Failing parser tests**

Create `src/lib/fetch-prices.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCoinGecko, parseStooqCsv } from "./fetch-prices";

describe("parseStooqCsv", () => {
  it("extracts the close as minor units", () => {
    const csv = "Symbol,Date,Time,Open,High,Low,Close,Volume\nFICT.US,2026-08-14,22:00:00,10.00,10.50,9.90,10.25,12345\n";
    expect(parseStooqCsv(csv)).toBe(1025);
  });

  it("returns null for N/D and malformed payloads", () => {
    expect(parseStooqCsv("Symbol,Date,Time,Open,High,Low,Close,Volume\nFICT.US,N/D,N/D,N/D,N/D,N/D,N/D,N/D\n")).toBeNull();
    expect(parseStooqCsv("")).toBeNull();
  });
});

describe("parseCoinGecko", () => {
  it("extracts a price in the requested currency as minor units", () => {
    expect(parseCoinGecko({ bitcoin: { usd: 12345.67 } }, "bitcoin", "usd")).toBe(1_234_567);
  });

  it("returns null when missing", () => {
    expect(parseCoinGecko({}, "bitcoin", "usd")).toBeNull();
    expect(parseCoinGecko({ bitcoin: {} }, "bitcoin", "usd")).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

Create `src/lib/fetch-prices.ts`:

```ts
export function parseStooqCsv(csv: string): number | null {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return null;
  const cols = lines[1].split(",");
  const close = Number(cols[6]);
  if (!Number.isFinite(close) || close <= 0) return null;
  return Math.round(close * 100);
}

export const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  ADA: "cardano",
  DOGE: "dogecoin",
  LTC: "litecoin",
  XRP: "ripple",
};

export function parseCoinGecko(json: unknown, id: string, vs: string): number | null {
  if (typeof json !== "object" || json === null) return null;
  const entry = (json as Record<string, Record<string, unknown>>)[id];
  const price = Number(entry?.[vs]);
  if (!Number.isFinite(price) || price <= 0) return null;
  return Math.round(price * 100);
}

async function get(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

export async function fetchEquityPriceMinor(symbol: string): Promise<number | null> {
  for (const candidate of [symbol.toLowerCase(), `${symbol.toLowerCase()}.us`]) {
    const res = await get(`https://stooq.com/q/l/?s=${encodeURIComponent(candidate)}&f=sd2t2ohlcv&h&e=csv`);
    if (!res) continue;
    const price = parseStooqCsv(await res.text());
    if (price !== null) return price;
  }
  return null;
}

export async function fetchCryptoPriceMinor(symbol: string, currency: string): Promise<number | null> {
  const id = COINGECKO_IDS[symbol.toUpperCase()];
  if (!id) return null;
  const vs = currency.toLowerCase();
  const res = await get(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=${vs}`,
  );
  if (!res) return null;
  return parseCoinGecko(await res.json(), id, vs);
}
```

In `src/app/actions/refresh.ts`, add:

```ts
import { fetchCryptoPriceMinor, fetchEquityPriceMinor } from "@/lib/fetch-prices";
import { redirect } from "next/navigation";

export async function refreshPrices(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const accountId = String(formData.get("accountId") ?? "");
  const account = await prisma.financialAccount.findFirst({
    where: { id: accountId, userId },
    include: { holdings: true },
  });
  if (!account) return;

  let updated = 0;
  let failed = 0;
  for (const holding of account.holdings) {
    const price =
      account.type === "CRYPTO"
        ? await fetchCryptoPriceMinor(holding.symbol, account.currency)
        : await fetchEquityPriceMinor(holding.symbol);
    if (price === null) {
      failed += 1;
      continue;
    }
    await prisma.holding.update({
      where: { id: holding.id },
      data: { lastPriceMinor: price, priceAsOf: new Date() },
    });
    updated += 1;
  }
  revalidatePath(`/investments/${accountId}`);
  revalidatePath("/");
  redirect(`/investments/${accountId}?prices=${updated} updated, ${failed} failed`);
}
```

In `src/app/investments/[id]/page.tsx`: accept a `prices` search param and show it as a small status line; add near the holdings header:

```tsx
        <form action={refreshPrices}>
          <input type="hidden" name="accountId" value={account.id} />
          <button type="submit" className="rounded border px-2 py-1 text-xs" title="Best-effort: Stooq (equities), CoinGecko (crypto). Manual entry always works.">
            ↻ prices
          </button>
        </form>
```

- [ ] **Step 3: Verify + commit**

Run: `npm test` (parsers green); dev-verify the button updates what it can and reports failures without breaking anything. `npm run lint && npm run build`.

```bash
git add src/lib/fetch-prices.* src/app/actions/refresh.ts src/app/investments/
git commit -m "feat: add best-effort price auto-fetch (Stooq, CoinGecko)"
```

---

### Task 6: Danger-month detector

**Files:**
- Create: `src/engine/dangermonth.ts`, `src/engine/dangermonth.test.ts`
- Modify: `prisma/schema.prisma` (Profile gains `cushionMinor Int @default(0)`), `src/engine/rules/types.ts` (ProfileView gains `cushionMinor: number`), `src/lib/profile.ts`, `src/lib/validation/profile.ts` + `src/app/settings/page.tsx` (cushion input via the existing dollar-amount pattern), `src/engine/rules/fixtures.ts` (default `cushionMinor: 0`), `src/engine/rules/index.ts` (+ rule), `src/app/bills/forecast/page.tsx` (min-balance column)

**Interfaces:**
- Produces:
  - `interface CashEvent { date: string; amountMinor: number; label: string }`
  - `projectDailyBalance(startMinor: number, events: CashEvent[], from: string, to: string): Array<{ date: string; balanceMinor: number }>` — events apply on their date; throws over 60 months.
  - `dangerMonths(series: Array<{ date: string; balanceMinor: number }>, cushionMinor: number): Array<{ month: string; minBalanceMinor: number; minDate: string }>` — months whose minimum dips below the cushion.
  - `incomeEvents(sources: IncomeSource[], from: string, to: string): CashEvent[]` — MONTHLY on the 1st, BIWEEKLY every 14 days from `from`, ANNUAL on Jan 1 (documented v1 approximation: pay-date precision is future work).
  - `DANGER_MONTH` rule (warning, kind compliance): start balance = CASH+CHEQUING account balances (CAD-converted), events = income − bill occurrences over the next 12 months; fires only when `profile.cushionMinor > 0`. `ALL_RULES` grows 22 → 23.
  - Forecast page gains a "Min balance" column + danger highlighting when a cushion is set.

- [ ] **Step 1: Write the failing test**

Create `src/engine/dangermonth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dangerMonths, incomeEvents, projectDailyBalance, type CashEvent } from "./dangermonth";

describe("projectDailyBalance", () => {
  it("applies events on their dates and carries the balance forward", () => {
    const events: CashEvent[] = [
      { date: "2026-01-05", amountMinor: -60_000, label: "Fixture Bill" },
      { date: "2026-01-10", amountMinor: 100_000, label: "Fixture Pay" },
    ];
    const series = projectDailyBalance(50_000, events, "2026-01-01", "2026-01-12");
    expect(series[0]).toEqual({ date: "2026-01-01", balanceMinor: 50_000 });
    expect(series[4]).toEqual({ date: "2026-01-05", balanceMinor: -10_000 });
    expect(series[9]).toEqual({ date: "2026-01-10", balanceMinor: 90_000 });
    expect(series[11]).toEqual({ date: "2026-01-12", balanceMinor: 90_000 });
  });
});

describe("dangerMonths", () => {
  it("flags months whose minimum dips below the cushion, with the dip date", () => {
    const series = [
      { date: "2026-01-05", balanceMinor: 40_000 },
      { date: "2026-01-20", balanceMinor: 90_000 },
      { date: "2026-02-10", balanceMinor: 120_000 },
    ];
    const result = dangerMonths(series, 50_000);
    expect(result).toEqual([{ month: "2026-01", minBalanceMinor: 40_000, minDate: "2026-01-05" }]);
  });

  it("still reports negative balances even with a zero cushion", () => {
    expect(dangerMonths([{ date: "2026-01-05", balanceMinor: -1 }], 0)).toEqual([
      { month: "2026-01", minBalanceMinor: -1, minDate: "2026-01-05" },
    ]);
  });
});

describe("incomeEvents", () => {
  it("expands monthly on the 1st and biweekly every 14 days", () => {
    const events = incomeEvents(
      [
        { name: "Fixture Salary", amountMinor: 200_000, cadence: "MONTHLY", kind: "EMPLOYMENT" },
        { name: "Fixture Gig", amountMinor: 50_000, cadence: "BIWEEKLY", kind: "SELF_EMPLOYMENT" },
      ],
      "2026-01-01",
      "2026-02-28",
    );
    const monthly = events.filter((e) => e.label === "Fixture Salary");
    const biweekly = events.filter((e) => e.label === "Fixture Gig");
    expect(monthly.map((e) => e.date)).toEqual(["2026-01-01", "2026-02-01"]);
    expect(biweekly).toHaveLength(5); // Jan 1, 15, 29, Feb 12, 26
  });
});
```

(Note the zero-cushion behavior: `dangerMonths` itself reports dips below the cushion *or below zero* — a negative balance is always dangerous. The rule additionally gates on `cushionMinor > 0` so the feature stays quiet until configured; the engine still reports true negatives.)

- [ ] **Step 2: Run to verify failure, implement**

Run: `npm test` — FAIL. Create `src/engine/dangermonth.ts`:

```ts
import type { IncomeSource } from "./rules/types";
import { occurrencesBetween } from "./recurrence";

export interface CashEvent {
  date: string;
  amountMinor: number;
  label: string;
}

const DAY_MS = 86_400_000;

function toMs(date: string): number {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function projectDailyBalance(
  startMinor: number,
  events: CashEvent[],
  from: string,
  to: string,
): Array<{ date: string; balanceMinor: number }> {
  const fromMs = toMs(from);
  const toLimit = toMs(to);
  if (fromMs > toLimit) throw new RangeError("inverted window");
  if ((toLimit - fromMs) / DAY_MS > 1830) throw new RangeError("window exceeds 60 months");

  const byDate = new Map<string, number>();
  for (const event of events) {
    byDate.set(event.date, (byDate.get(event.date) ?? 0) + event.amountMinor);
  }

  const series: Array<{ date: string; balanceMinor: number }> = [];
  let balance = startMinor;
  for (let ms = fromMs; ms <= toLimit; ms += DAY_MS) {
    const date = toIso(ms);
    balance += byDate.get(date) ?? 0;
    series.push({ date, balanceMinor: balance });
  }
  return series;
}

export function dangerMonths(
  series: Array<{ date: string; balanceMinor: number }>,
  cushionMinor: number,
): Array<{ month: string; minBalanceMinor: number; minDate: string }> {
  const byMonth = new Map<string, { minBalanceMinor: number; minDate: string }>();
  for (const point of series) {
    const month = point.date.slice(0, 7);
    const current = byMonth.get(month);
    if (!current || point.balanceMinor < current.minBalanceMinor) {
      byMonth.set(month, { minBalanceMinor: point.balanceMinor, minDate: point.date });
    }
  }
  const threshold = Math.max(cushionMinor, 0);
  return [...byMonth.entries()]
    .filter(([, v]) => v.minBalanceMinor < threshold || v.minBalanceMinor < 0)
    .map(([month, v]) => ({ month, ...v }));
}

export function incomeEvents(sources: IncomeSource[], from: string, to: string): CashEvent[] {
  return sources.flatMap((source) => {
    if (source.cadence === "MONTHLY") {
      return occurrencesBetween({ type: "MONTHLY", dayOfMonth: 1 }, from, to).map((date) => ({
        date,
        amountMinor: source.amountMinor,
        label: source.name,
      }));
    }
    if (source.cadence === "BIWEEKLY") {
      return occurrencesBetween({ type: "BIWEEKLY", anchor: from }, from, to).map((date) => ({
        date,
        amountMinor: source.amountMinor,
        label: source.name,
      }));
    }
    return occurrencesBetween({ type: "ANNUAL", anchor: `${from.slice(0, 4)}-01-01` }, from, to).map(
      (date) => ({ date, amountMinor: source.amountMinor, label: source.name }),
    );
  });
}
```

Run: `npm test` — expect pass.

- [ ] **Step 3: Wire the profile field, the rule, and the forecast column**

1. Schema: add `cushionMinor Int @default(0)` to `Profile`; `npx dotenv -e .env.local -- npx prisma migrate dev --name cushion`.
2. `ProfileView` gains `cushionMinor: number`; map it in `getOrCreateProfile`; fixtures default `cushionMinor: 0`; settings form adds "Cash cushion ($)" using the existing dollar-amount pattern in `validation/profile.ts`.
3. New rule in `src/engine/rules/bill-rules.ts` (registered in `index.ts`, key `DANGER_MONTH`, kind "compliance", severity "warning"): when `profile.cushionMinor > 0`, build events = `incomeEvents(profile.incomeSources, today, +12mo)` minus every bill occurrence (`billOccurrences` over the same window, negated), start = sum of CASH/CHEQUING `balanceMinor` CAD-converted, then `dangerMonths(projectDailyBalance(...), cushionMinor)`; emit one alert listing up to 3 months with their min balances and dip dates, `action` explaining the cushion setting. Unit-test with invented fixture bills/income asserting a known dip month.
4. Forecast page: when the cushion is set, run the same projection and add a "Min balance" column, highlighting danger months (reuse the amber row style).
5. Update the `ALL_RULES` count test 22 → 23.

- [ ] **Step 4: Run all tests, commit**

Run: `npm test && npm run lint && npm run build` — all pass, Phase 2/3/4 suites untouched.

```bash
git add prisma/ src/engine/ src/lib/ src/app/settings/ src/app/bills/forecast/
git commit -m "feat: add danger-month detector with cash cushion"
```

---

### Task 7: Tax-season checklist

**Files:**
- Create: `src/engine/taxchecklist.ts`, `src/engine/taxchecklist.test.ts`, `src/app/money-finder/tax/page.tsx`
- Modify: `src/engine/rules/index.ts` (+ `TAX_SEASON` nudge rule in `bill-rules.ts` or a new `season.ts`), `src/app/money-finder/page.tsx` (link)

**Interfaces:**
- Produces:
  - `type ChecklistStatus = "REQUIRED" | "LIKELY" | "CHECK" | "NOT_APPLICABLE"`
  - `buildTaxChecklist(profile: ProfileView, snapshot: FinancialSnapshot): Array<{ item: string; status: ChecklistStatus; detail: string }>` — assembled purely from existing engines: FBAR (max aggregate vs threshold → REQUIRED/NOT_APPLICABLE with the dollar figure), Form 8938 (status by filing thresholds), Form 8621 count (= PFIC alerts, one per holding), T1135 (CHECK when over), RRSP contributions logged this year + first-60-days note, student-loan interest reminder (when matching bills exist), DTC claim (when eligible), CWB (when likely), TFSA US-income summary for the 1040.
  - `/money-finder/tax` — printable checklist page grouped by status; `TAX_SEASON` rule: info alert during January–April linking to the page. `ALL_RULES` 23 → 24.

- [ ] **Step 1: Write the failing test**

Create `src/engine/taxchecklist.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeAccount, makeHolding, makeProfile, makeSnapshot, makeTx } from "./rules/fixtures";
import { buildTaxChecklist } from "./taxchecklist";

describe("buildTaxChecklist", () => {
  it("marks FBAR REQUIRED and counts 8621s from PFIC hits", () => {
    const tfsa = makeAccount({
      type: "TFSA",
      currency: "USD",
      balanceMinor: 1_500_000, // $15k USD > $10k FBAR threshold
      snapshots: [{ balanceMinor: 1_500_000, asOf: "2026-02-01" }],
      holdings: [
        makeHolding({ symbol: "FAKE.TO", domicileCountry: "CA" }),
        makeHolding({ symbol: "ALSO.NE", domicileCountry: "CA" }),
      ],
    });
    const list = buildTaxChecklist(makeProfile(), makeSnapshot([tfsa]));
    const fbar = list.find((i) => i.item.includes("FinCEN 114"))!;
    expect(fbar.status).toBe("REQUIRED");
    expect(fbar.detail).toContain("$15,000.00");
    const pfic = list.find((i) => i.item.includes("8621"))!;
    expect(pfic.status).toBe("REQUIRED");
    expect(pfic.detail).toContain("2");
  });

  it("marks FBAR NOT_APPLICABLE when under threshold and includes RRSP contributions", () => {
    const rrsp = makeAccount({
      type: "RRSP",
      balanceMinor: 100_000,
      transactions: [makeTx({ type: "CONTRIBUTION", amountMinor: 250_000, date: "2026-03-01" })],
    });
    const list = buildTaxChecklist(makeProfile(), makeSnapshot([rrsp]));
    expect(list.find((i) => i.item.includes("FinCEN 114"))!.status).toBe("NOT_APPLICABLE");
    expect(list.find((i) => i.item.includes("RRSP"))!.detail).toContain("$2,500.00");
  });

  it("includes DTC only when eligible", () => {
    const withDtc = buildTaxChecklist(makeProfile({ dtcEligible: true }), makeSnapshot([]));
    const without = buildTaxChecklist(makeProfile(), makeSnapshot([]));
    expect(withDtc.some((i) => i.item.includes("Disability"))).toBe(true);
    expect(without.some((i) => i.item.includes("Disability"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure, implement**

Run: `npm test` — FAIL. Create `src/engine/taxchecklist.ts` assembling from existing pieces (`maxForeignAggregateUsd`, `pficRule`, `t1135Rule`, `THRESHOLDS`, `txsThisYear`, `formatMinorUnits`) — every item gets `{ item, status, detail }`; PFIC count = `pficRule.evaluate(profile, snapshot).length`; RRSP contributions summed from `txsThisYear` on RRSP accounts; statuses per the Interfaces block. (~80 lines, same style as the rules files; no new math — only composition of tested functions.)

Then the page `src/app/money-finder/tax/page.tsx`: `requireUserId` → `getOrCreateProfile` + `buildSnapshot` → render grouped by status (REQUIRED first) with a print-friendly layout and the standard not-advice footer; link it from the Money Finder header. Add the `TAX_SEASON` rule (fires when `snapshot.today.slice(5, 7)` is `01`–`04`): info alert "Tax season: your checklist is ready" linking `/money-finder/tax`; register it; update the count test 23 → 24 and add a two-case unit test (fires in February, silent in August).

- [ ] **Step 3: Run all tests, commit**

Run: `npm test && npm run lint && npm run build`.

```bash
git add src/engine/ src/app/money-finder/
git commit -m "feat: add tax-season checklist generator and January nudge"
```

---

### Task 8: PWA tuning

**Files:**
- Create: `public/icon.svg`, `public/sw.js`, `src/components/sw-register.tsx`, `src/app/offline/page.tsx`
- Modify: `src/app/manifest.ts` (icons), `src/app/layout.tsx` (register SW)

**Interfaces:**
- Produces: installable PWA with an icon; a minimal service worker (network-first pages with an offline fallback, cache-first `_next/static`; **never caches `/api/`** — auth/data stay live); `/offline` fallback page.

- [ ] **Step 1: Icon + manifest**

Create `public/icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0a0a0a"/>
  <text x="256" y="316" font-family="system-ui, sans-serif" font-size="220" font-weight="700" fill="#4ade80" text-anchor="middle">MT</text>
</svg>
```

In `src/app/manifest.ts`, set:

```ts
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
```

(SVG icons install on Chromium/Android — the primary phone target. PNG rasters for broader coverage are a follow-up; note it in the commit body.)

- [ ] **Step 2: Service worker**

Create `public/sw.js`:

```js
const CACHE = "moneytalks-v1";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(event.request);
        if (hit) return hit;
        const res = await fetch(event.request);
        if (res.ok) cache.put(event.request, res.clone());
        return res;
      }),
    );
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
  }
});
```

Create `src/components/sw-register.tsx`:

```tsx
"use client";

import { useEffect } from "react";

export function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
```

Create `src/app/offline/page.tsx`:

```tsx
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-xl font-semibold">Offline</h1>
      <p className="text-sm text-muted-foreground">
        MoneyTalks needs a connection for live data. The wallet cheat sheet is worth a screenshot
        for moments like this.
      </p>
    </main>
  );
}
```

Mount `<SwRegister />` in `src/app/layout.tsx` inside `<body>`.

- [ ] **Step 3: Verify + commit**

Run: `npm run build && npm start` — Lighthouse/devtools shows the manifest with icon and a registered SW in production mode; `/offline` renders; API requests bypass the SW. Then `npm test && npm run lint`.

```bash
git add public/ src/components/sw-register.tsx src/app/
git commit -m "feat: add PWA icon, service worker, and offline fallback"
```

---

### Task 9: E2E additions + full gate

**Files:**
- Create: `e2e/fixtures/statement-sample.csv`, `e2e/polish.spec.ts`

- [ ] **Step 1: Fixture CSV** (invented):

Create `e2e/fixtures/statement-sample.csv`:

```csv
Date,Description,Amount
01/05/2026,SUPERMARKET PLAZA,1000.00
01/07/2026,PIZZA PALACE,500.00
01/09/2026,MYSTERY VENDOR,200.00
```

- [ ] **Step 2: E2E spec**

Create `e2e/polish.spec.ts`:

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

test("csv import, analyzer, and tax checklist", async ({ browser, baseURL }) => {
  const context = await createAuthedContext(browser, baseURL!);
  const page = await context.newPage();

  // Seed: accounts fixture (Phase 1) + cards fixture (Phase 4)
  for (const fixture of ["import-sample.json", "cards-sample.json"]) {
    await page.goto("/investments/import");
    await page.locator('input[name="file"]').setInputFiles(path.join(__dirname, "fixtures", fixture));
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page.getByText(/Imported:/)).toBeVisible();
  }

  // CSV import into the fictional RRSP: 3 rows in, then re-import → 3 duplicates skipped
  await page.goto("/investments");
  await page.getByText("Maple RRSP").click();
  await page.getByRole("link", { name: "Import CSV" }).click();
  await page.locator('input[name="file"]').setInputFiles(path.join(__dirname, "fixtures", "statement-sample.csv"));
  await page.locator('select[name="dateFormat"]').selectOption("MDY");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("3 imported, 0 duplicates skipped, 0 error rows")).toBeVisible();
  await page.locator('input[name="file"]').setInputFiles(path.join(__dirname, "fixtures", "statement-sample.csv"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("0 imported, 3 duplicates skipped, 0 error rows")).toBeVisible();

  // Analyzer: Beta statement → hand-checked missed-rewards figure ($41.50)
  await page.goto("/cards/analyzer");
  await page.locator('select[name="cardId"]').selectOption({ label: "Fixture Beta Visa" });
  await page.locator('input[name="file"]').setInputFiles(path.join(__dirname, "fixtures", "statement-sample.csv"));
  await page.getByRole("button", { name: "Analyze" }).click();
  await expect(page.getByTestId("analyzer-report")).toContainText("You left $41.50 on the table");

  // Tax checklist renders with the FBAR line
  await page.goto("/money-finder/tax");
  await expect(page.getByText(/FinCEN 114/)).toBeVisible();

  await context.close();
});
```

- [ ] **Step 3: Full gate**

Run: `npm test && npm run lint && npm run build && npm run e2e` — everything green.

```bash
git add e2e/
git commit -m "test: add polish-phase E2E (CSV dedupe, analyzer, tax checklist)"
```

---

### Task 10: Final deploy + wrap-up

**OWNER CHECKPOINT** (whole task).

- [ ] **Step 1: Clear any pending Phase-4 checkpoints first** — if Phase 4 was never pushed/imported, that audit + push + real-wallet import happens now, before this phase's push.

- [ ] **Step 2: Pre-push audit and push** — audit `git diff origin/main..HEAD` for personal tokens and real-wallet values (invented fixtures only); confirm with the owner per the standing rule; push with permission. Vercel deploys with the two Profile migrations.

- [ ] **Step 3: Production verification with the owner** — ↻ FX pulls a real Bank of Canada rate; ↻ prices updates what it can on a real account; the owner sets their real cash cushion in Settings and reviews the danger-month output against their own expectations; the tax checklist reflects their real data; a real statement CSV runs through the analyzer; the app installs to the phone home screen with the icon.

- [ ] **Step 4: Mark the spec complete** — every phase row of `docs/superpowers/specs/2026-08-14-moneytalks-design.md` §7 is now shipped. Update `README.md`'s feature list to match reality (public-safe wording) and link `docs/ROADMAP.md` — the single parking lot for all deferred ideas (demo mode, benefits calendar/ICS, reminders, historical FX, per-account danger months, and the rest). New work starts with a new brainstorm, not scope creep here.

---

## Self-review notes

- **Spec coverage (§7 Phase 5 row):** CSV import with dedupe preview ✔ (T1/T2; "preview" satisfied by the mapped-row error reporting + counts — a visual pre-import table was traded for the safer idempotent import + counts report, documented here), tax-season checklist ✔ (T7), BoC Valet FX auto-fetch with manual override ✔ (T4; JMD stays manual — Valet has no JMD series), danger-month detector ✔ (T6), price auto-fetch best-effort ✔ (T5), PWA tuning ✔ (T8). CardPilot P2 statement analyzer ✔ (T3). All 6 spec items + the carried P2 promise.
- **Hand-checked arithmetic:** analyzer Beta: 3%×$1,000=30.00 + 1.5%×$500=7.50 + 1.5%×$200=3.00 → $40.50 earned; optimal: 4.8%×$1,000=48.00 + 6%×$500=30.00 + 2%×$200=4.00 → $82.00; missed $41.50 ✔ (E2E asserts it); danger series: 50,000−60,000=−10,000 on Jan 5, +100,000=90,000 on Jan 10 ✔; biweekly income count Jan 1→Feb 28 = 5 events ✔ (1,15,29,12,26); Stooq close 10.25 → 1025 ✔; CoinGecko 12,345.67 → 1,234,567 ✔.
- **Type consistency:** `MappedRow` union narrowing used in both import actions ✔; `ColumnMapping` shared by T2/T3 forms ✔; `CashEvent`/`IncomeSource` reuse rules types ✔; rule count assertions updated in lockstep (22→23→24, each task states its increment).
- **Known risks stated:** Stooq/CoinGecko are unofficial-tier free sources — wrappers null out on any failure and manual entry remains primary (the stale-data rule is the safety net); SVG-only manifest icon covers the Android/Chromium install path, PNG rasters deferred; income-event dates are v1 approximations (documented in the engine and the rule's action text); the analyzer's category heuristics are hedged in the UI copy.
