# MoneyTalks Phase 2 (Money Finder) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The rules engine and Money Finder page — compliance warnings (FBAR, 8938, PFIC, Roth freeze, TFSA reality, T1135, room guards) and money opportunities (RDSP CDSG/CDSB, FHSA/TFSA/RRSP room, DTC, CWB, employment amount, income-support thresholds, NHT), evaluated fresh on every load from the user's profile + financial data, with persistent dismissals and an alerts panel on the dashboard.

**Architecture:** Rules are pure objects in `src/engine/rules/` — `{ key, jurisdiction, kind, citation, lastReviewed, evaluate(profile, snapshot) }` — run by a registry that isolates per-rule failures. All numeric thresholds live in one `thresholds.ts` with citations. A thin server-side assembler builds the `FinancialSnapshot` from Prisma rows; computed alerts are never stored — only dismissals persist (`Alert` table keyed `userId + ruleKey + entityRef`).

**Tech Stack:** No new dependencies. Everything builds on Phases 0–1.

**Spec:** `docs/superpowers/specs/2026-08-14-moneytalks-design.md`

**Prerequisite:** Phase 1 complete (engines `money/fx/balance/networth`, `requireUserId`/`getSessionUserId`, validation module, import, E2E session helper all present).

## Global Constraints

All Phase 0/1 Global Constraints apply verbatim (public repo — zero personal data anywhere including fixtures; integer minor units; pure engines with "now" as a parameter; strict TS; userId scoping; 401 unauthenticated APIs; commit trailer; OWNER CHECKPOINT protocol). Phase-2 additions:

- **Threshold honesty:** every number in `thresholds.ts` carries a citation and `lastReviewed` date. The values written in this plan were compiled 2026-08-14 from training knowledge — **Task 2 includes a mandatory web-verification step**; the implementer must confirm each value against its cited source and correct any drift before the thresholds commit. Program rules (CWB, OW/ODSP, DTC amounts) change annually — language in alerts uses "approximately/up to" and every alert's `action` tells the user what to verify.
- **Not advice:** the Money Finder page footer states the app surfaces published program rules against the user's own data and is not financial or tax advice. Alerts never say "you should invest/sell X" — they say "rule R applies to holding H; the documented fix is F; verify with your accountant."
- **Bill-dependent rules are deferred to Phase 3** (documented deviation from the spec's launch list): digital-news credit (#16), student-loan interest (#18), and the mortgage prepayment window (#19) need the Bills module's data to evaluate. They ship with Phase 3; the spec's remaining 17 rules ship here.
- `Alert.entityRef` is a non-nullable `String @default("")` — empty string means "the rule as a whole". (Nullable would break the unique constraint: Postgres treats NULLs as distinct.)

---

### Task 1: Schema — Profile + Alert (dismissal) models

**Files:**
- Modify: `prisma/schema.prisma` (add models; add `profile Profile?` and `alerts Alert[]` relations to `User`)

**Interfaces:**
- Produces: `Profile` (1:1 with User — the rules engine's inputs) and `Alert` (dismissal/override log only; computed alerts are never stored).

- [x] **Step 1: Extend the schema**

Append to `prisma/schema.prisma`:

```prisma
// ---- Money Finder (Phase 2) ----

model Profile {
  userId                   String   @id
  user                     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  residency                String   @default("CA")
  citizenships             String[] @default([])
  filingStatus             String   @default("SINGLE_ABROAD") // SINGLE_ABROAD | MFJ_ABROAD | OTHER
  marginalUSRatePct        Int      @default(24)
  dtcEligible              Boolean  @default(false)
  benefitPrograms          String[] @default([]) // e.g. ["OW"] or ["ODSP"]
  rdspIncomeTier           String   @default("UNKNOWN") // LOW | HIGH | UNKNOWN
  rdspCarryForwardYears    Int      @default(0)
  rdspGrantsLifetimeMinor  Int      @default(0)
  rdspContribLifetimeMinor Int      @default(0)
  tfsaRoomMinor            Int      @default(0)
  rrspRoomMinor            Int      @default(0)
  fhsaRoomMinor            Int      @default(0)
  nhtContributed           Boolean  @default(false)
  incomeSources            Json     @default("[]") // [{name, amountMinor, cadence, kind}]
  updatedAt                DateTime @updatedAt
}

model Alert {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  ruleKey     String
  entityRef   String   @default("") // "" = whole rule; else holdingId/accountId/txId
  dismissedAt DateTime @default(now())

  @@unique([userId, ruleKey, entityRef])
}
```

- [x] **Step 2: Migrate, verify, commit**

```bash
npx dotenv -e .env.local -- npx prisma migrate dev --name profile-and-alerts
npx dotenv -e .env.local -- npx prisma migrate status
npm run build
git add prisma/
git commit -m "feat: add Profile and Alert dismissal models"
```

---

### Task 2: Rules core — types, thresholds (verified), registry, dismissals, test fixtures

**Files:**
- Create: `src/engine/rules/types.ts`, `src/engine/rules/thresholds.ts`, `src/engine/rules/registry.ts`, `src/engine/rules/registry.test.ts`, `src/engine/rules/fixtures.ts`

**Interfaces:**
- Consumes: `Currency` (`@/engine/money`), `FxRateInput` (`@/engine/fx`), `TxTypeName` (`@/engine/balance`).
- Produces (used by every rule task and the UI):
  - `RuleAlert { ruleKey; severity: "info"|"warning"|"critical"; kind: "compliance"|"opportunity"; entityRef: string; title; message; action; citation; valueMinor?; valueCurrency? }`
  - `ProfileView`, `AccountView`, `HoldingView`, `TxView`, `FinancialSnapshot { today: string; accounts: AccountView[]; fxRates: FxRateInput[] }`
  - `Rule { key; jurisdiction; kind; citation; lastReviewed; evaluate(profile, snapshot): RuleAlert[] }`
  - `evaluateRules(profile, snapshot, rules): { alerts: RuleAlert[]; errors: Array<{ ruleKey: string; message: string }> }` — per-rule try/catch; sorts by severity (critical→info) then `valueMinor` desc; appends one info alert listing rules whose `lastReviewed` is >365 days before `snapshot.today`.
  - `applyDismissals(alerts: RuleAlert[], dismissals: Array<{ ruleKey: string; entityRef: string }>): { active: RuleAlert[]; dismissed: RuleAlert[] }`
  - Test fixtures: `makeProfile(overrides?)`, `makeAccount(overrides?)`, `makeHolding(overrides?)`, `makeTx(overrides?)`, `makeSnapshot(accounts, overrides?)` — fictional defaults, used by every rule test.

- [x] **Step 1: Write the types**

Create `src/engine/rules/types.ts`:

```ts
import type { TxTypeName } from "../balance";
import type { FxRateInput } from "../fx";
import type { Currency } from "../money";

export type Severity = "info" | "warning" | "critical";
export type RuleKind = "compliance" | "opportunity";

export interface RuleAlert {
  ruleKey: string;
  severity: Severity;
  kind: RuleKind;
  entityRef: string; // "" = whole rule
  title: string;
  message: string;
  action: string;
  citation: string;
  valueMinor?: number;
  valueCurrency?: Currency;
}

export interface HoldingView {
  id: string;
  symbol: string;
  name: string;
  domicileCountry: string;
  quantity: number;
  bookCostMinor: number | null;
  lastPriceMinor: number;
  priceAsOf: string;
}

export interface TxView {
  id: string;
  type: TxTypeName;
  amountMinor: number;
  currency: string;
  date: string;
}

export interface AccountView {
  id: string;
  type: string;
  name: string;
  institution: string;
  country: string;
  currency: Currency;
  isUSSitus: boolean;
  balanceMinor: number;
  balanceAsOf: string | null;
  holdings: HoldingView[];
  transactions: TxView[];
  snapshots: Array<{ balanceMinor: number; asOf: string }>;
}

export type IncomeCadence = "MONTHLY" | "BIWEEKLY" | "ANNUAL";
export type IncomeKind = "EMPLOYMENT" | "SELF_EMPLOYMENT" | "BENEFIT" | "RENTAL" | "OTHER";

export interface IncomeSource {
  name: string;
  amountMinor: number;
  cadence: IncomeCadence;
  kind: IncomeKind;
}

export interface ProfileView {
  residency: string;
  citizenships: string[];
  filingStatus: "SINGLE_ABROAD" | "MFJ_ABROAD" | "OTHER";
  marginalUSRatePct: number;
  dtcEligible: boolean;
  benefitPrograms: string[];
  rdspIncomeTier: "LOW" | "HIGH" | "UNKNOWN";
  rdspCarryForwardYears: number;
  rdspGrantsLifetimeMinor: number;
  rdspContribLifetimeMinor: number;
  tfsaRoomMinor: number;
  rrspRoomMinor: number;
  fhsaRoomMinor: number;
  nhtContributed: boolean;
  incomeSources: IncomeSource[];
}

export interface FinancialSnapshot {
  today: string; // ISO date — rules never call Date.now()
  accounts: AccountView[];
  fxRates: FxRateInput[];
}

export interface Rule {
  key: string;
  jurisdiction: "US" | "CA" | "JM" | "CROSS";
  kind: RuleKind;
  citation: string;
  lastReviewed: string;
  evaluate(profile: ProfileView, snapshot: FinancialSnapshot): RuleAlert[];
}

export function annualizeMinor(source: IncomeSource): number {
  switch (source.cadence) {
    case "MONTHLY":
      return source.amountMinor * 12;
    case "BIWEEKLY":
      return source.amountMinor * 26;
    case "ANNUAL":
      return source.amountMinor;
  }
}

export function monthlyMinor(source: IncomeSource): number {
  return Math.round(annualizeMinor(source) / 12);
}

export function currentYear(today: string): string {
  return today.slice(0, 4);
}

export function txsThisYear(account: AccountView, today: string, type?: TxTypeName): TxView[] {
  const year = currentYear(today);
  return account.transactions.filter(
    (t) => t.date.slice(0, 4) === year && (type ? t.type === type : true),
  );
}
```

- [x] **Step 2: Write the thresholds file**

Create `src/engine/rules/thresholds.ts`. **Every value below must be web-verified in Step 3 before committing** — they were compiled 2026-08-14 and several change annually:

```ts
// All amounts are integer minor units (cents) unless noted.
// Each entry cites its source. Program parameters change annually —
// alerts phrase these as "approximately/up to" and tell the user what to verify.

export const THRESHOLDS = {
  // FinCEN Form 114 (FBAR): 31 CFR 1010.350; aggregate max of non-US accounts, any point in the calendar year.
  FBAR_AGGREGATE_USD: 10_000_00,

  // IRS Form 8938 (FATCA), US person living abroad: 26 CFR 1.6038D-2.
  FORM_8938: {
    SINGLE_ABROAD: { yearEndUsd: 200_000_00, anyTimeUsd: 300_000_00 },
    MFJ_ABROAD: { yearEndUsd: 400_000_00, anyTimeUsd: 600_000_00 },
    OTHER: { yearEndUsd: 50_000_00, anyTimeUsd: 75_000_00 }, // US-resident single baseline
  },

  // PFIC heuristic: Canadian-listed fund suffixes (Form 8621, IRC §1291-1298).
  PFIC_TICKER_SUFFIXES: [".TO", ".V", ".NE"],

  // US–Canada treaty Art. XXI(2) does NOT cover TFSAs; dividends withheld at treaty rate.
  TFSA_US_DIVIDEND_WITHHOLDING_PCT: 15,

  // CRA T1135: cost of specified foreign property > CAD $100,000 (ITA s.233.3).
  T1135_COST_CAD: 100_000_00,

  // Canada Disability Savings Grant (CDSG), Canada Disability Savings Act / ESDC.
  // Low-tier (family net income under the annual threshold): 300% on first $500, 200% on next $1,000.
  // High tier (or unknown): 100% on first $1,000.
  CDSG: {
    LOW_BANDS: [
      { matchRate: 3, contributionCap: 500_00 },
      { matchRate: 2, contributionCap: 1_000_00 },
    ],
    HIGH_BANDS: [{ matchRate: 1, contributionCap: 1_000_00 }],
    ANNUAL_MAX_WITH_CARRYFORWARD: 10_500_00, // max grant payable in one year
    LIFETIME_GRANT_MAX: 70_000_00,
    LIFETIME_CONTRIB_MAX: 200_000_00,
    INCOME_THRESHOLD_NOTE: "2026 family-income threshold — verify current figure at canada.ca (≈ $111,733 for 2024)",
  },

  // Canada Disability Savings Bond (CDSB): up to $1,000/yr, no contribution required, income-tested.
  CDSB: { ANNUAL_MAX: 1_000_00, LIFETIME_MAX: 20_000_00 },

  // FHSA: ITA s.146.6 — $8,000 annual, $40,000 lifetime.
  FHSA: { ANNUAL_CAP: 8_000_00, LIFETIME_CAP: 40_000_00 },

  // TFSA/RRSP over-contribution penalty: 1%/month on the excess (ITA s.207.02 / s.204.1).
  OVERCONTRIBUTION_PENALTY_PCT_PER_MONTH: 1,

  // Disability Tax Credit, federal disability amount (line 31600) — 2025 figure, indexed annually.
  DTC_FEDERAL_AMOUNT: 9_872_00,
  FEDERAL_CREDIT_RATE_PCT: 15,

  // Canada Workers Benefit (single, no dependants) — 2025 figures, indexed annually.
  CWB: { MIN_WORKING_INCOME: 3_000_00, NET_INCOME_CUTOFF_SINGLE: 36_749_00, MAX_SINGLE: 1_590_00 },

  // Canada Employment Amount (line 31260) — 2025 figure, indexed annually.
  CANADA_EMPLOYMENT_AMOUNT: 1_433_00,

  // Ontario Works (OW) / ODSP — earnings exemptions and asset limits; Ontario regs, change often. VERIFY.
  ONTARIO_SUPPORT: {
    OW: { MONTHLY_EARNINGS_EXEMPT: 200_00, CLAWBACK_PCT: 50, ASSET_LIMIT_SINGLE: 10_000_00 },
    ODSP: { MONTHLY_EARNINGS_EXEMPT: 1_000_00, CLAWBACK_PCT: 75, ASSET_LIMIT_SINGLE: 40_000_00 },
    // Asset treatment: RDSP is exempt for both; principal residence exempt; TFSA/cash/non-registered count.
  },

  // Jamaica NHT: contributions refundable in the 8th year after contribution (nht.gov.jm).
  NHT_REFUND_WAIT_YEARS: 7,

  STALE_DATA_DAYS: 30,
  RULE_REVIEW_STALE_DAYS: 365,
} as const;
```

- [x] **Step 3: MANDATORY — web-verify every threshold**

For each entry in `thresholds.ts`: check the cited source (canada.ca for CDSG/CDSB/FHSA/CWB/DTC/CEA figures; irs.gov for FBAR/8938/PFIC; ontario.ca for OW/ODSP; nht.gov.jm for NHT). Correct any value that has drifted, update the comment with the verified year, and set each rule's `lastReviewed` (Tasks 5–9) to the verification date. Record a one-line note per corrected value in the commit message body.

- [x] **Step 4: Write the failing registry test**

Create `src/engine/rules/fixtures.ts`:

```ts
import type { AccountView, FinancialSnapshot, HoldingView, ProfileView, TxView } from "./types";

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

export function makeProfile(overrides: Partial<ProfileView> = {}): ProfileView {
  return {
    residency: "CA",
    citizenships: ["US", "CA"],
    filingStatus: "SINGLE_ABROAD",
    marginalUSRatePct: 24,
    dtcEligible: false,
    benefitPrograms: [],
    rdspIncomeTier: "UNKNOWN",
    rdspCarryForwardYears: 0,
    rdspGrantsLifetimeMinor: 0,
    rdspContribLifetimeMinor: 0,
    tfsaRoomMinor: 0,
    rrspRoomMinor: 0,
    fhsaRoomMinor: 0,
    nhtContributed: false,
    incomeSources: [],
    ...overrides,
  };
}

export function makeHolding(overrides: Partial<HoldingView> = {}): HoldingView {
  return {
    id: nextId("h"),
    symbol: "FICT",
    name: "Fictional Holding",
    domicileCountry: "CA",
    quantity: 1,
    bookCostMinor: null,
    lastPriceMinor: 100_00,
    priceAsOf: "2026-08-01",
    ...overrides,
  };
}

export function makeTx(overrides: Partial<TxView> = {}): TxView {
  return {
    id: nextId("t"),
    type: "CONTRIBUTION",
    amountMinor: 100_00,
    currency: "CAD",
    date: "2026-06-01",
    ...overrides,
  };
}

export function makeAccount(overrides: Partial<AccountView> = {}): AccountView {
  return {
    id: nextId("a"),
    type: "TFSA",
    name: "Fixture Account",
    institution: "Fixture Trust",
    country: "CA",
    currency: "CAD",
    isUSSitus: false,
    balanceMinor: 0,
    balanceAsOf: null,
    holdings: [],
    transactions: [],
    snapshots: [],
    ...overrides,
  };
}

export function makeSnapshot(
  accounts: AccountView[],
  overrides: Partial<FinancialSnapshot> = {},
): FinancialSnapshot {
  return {
    today: "2026-08-14",
    accounts,
    fxRates: [{ base: "USD", quote: "CAD", rate: 1.4, asOf: "2026-08-01" }],
    ...overrides,
  };
}
```

Create `src/engine/rules/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeProfile, makeSnapshot } from "./fixtures";
import { applyDismissals, evaluateRules } from "./registry";
import type { Rule, RuleAlert } from "./types";

const okAlert: RuleAlert = {
  ruleKey: "OK_RULE",
  severity: "info",
  kind: "opportunity",
  entityRef: "",
  title: "ok",
  message: "m",
  action: "a",
  citation: "c",
};

const okRule: Rule = {
  key: "OK_RULE",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "c",
  lastReviewed: "2026-08-14",
  evaluate: () => [okAlert],
};

const throwingRule: Rule = {
  key: "BROKEN_RULE",
  jurisdiction: "CA",
  kind: "compliance",
  citation: "c",
  lastReviewed: "2026-08-14",
  evaluate: () => {
    throw new Error("boom");
  },
};

const criticalRule: Rule = {
  key: "CRIT_RULE",
  jurisdiction: "US",
  kind: "compliance",
  citation: "c",
  lastReviewed: "2026-08-14",
  evaluate: () => [{ ...okAlert, ruleKey: "CRIT_RULE", severity: "critical", kind: "compliance" }],
};

const staleRule: Rule = { ...okRule, key: "OLD_RULE", lastReviewed: "2024-01-01", evaluate: () => [] };

describe("evaluateRules", () => {
  const profile = makeProfile();
  const snapshot = makeSnapshot([]);

  it("collects alerts and isolates throwing rules as errors", () => {
    const { alerts, errors } = evaluateRules(profile, snapshot, [okRule, throwingRule]);
    expect(alerts.some((a) => a.ruleKey === "OK_RULE")).toBe(true);
    expect(errors).toEqual([{ ruleKey: "BROKEN_RULE", message: "boom" }]);
  });

  it("sorts critical before info", () => {
    const { alerts } = evaluateRules(profile, snapshot, [okRule, criticalRule]);
    expect(alerts[0].ruleKey).toBe("CRIT_RULE");
  });

  it("flags rules not reviewed within 365 days", () => {
    const { alerts } = evaluateRules(profile, snapshot, [staleRule]);
    expect(alerts.some((a) => a.ruleKey === "RULES_STALE" && a.message.includes("OLD_RULE"))).toBe(true);
  });
});

describe("applyDismissals", () => {
  it("splits active from dismissed by ruleKey + entityRef", () => {
    const alerts = [okAlert, { ...okAlert, entityRef: "h-1" }];
    const { active, dismissed } = applyDismissals(alerts, [{ ruleKey: "OK_RULE", entityRef: "h-1" }]);
    expect(active).toHaveLength(1);
    expect(active[0].entityRef).toBe("");
    expect(dismissed).toHaveLength(1);
  });
});
```

- [x] **Step 5: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `./registry`.

- [x] **Step 6: Implement the registry**

Create `src/engine/rules/registry.ts`:

```ts
import { THRESHOLDS } from "./thresholds";
import type { FinancialSnapshot, ProfileView, Rule, RuleAlert } from "./types";

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 } as const;

export function evaluateRules(
  profile: ProfileView,
  snapshot: FinancialSnapshot,
  rules: Rule[],
): { alerts: RuleAlert[]; errors: Array<{ ruleKey: string; message: string }> } {
  const alerts: RuleAlert[] = [];
  const errors: Array<{ ruleKey: string; message: string }> = [];

  for (const rule of rules) {
    try {
      alerts.push(...rule.evaluate(profile, snapshot));
    } catch (e) {
      errors.push({ ruleKey: rule.key, message: e instanceof Error ? e.message : String(e) });
    }
  }

  const staleCutoff = new Date(snapshot.today).getTime() - THRESHOLDS.RULE_REVIEW_STALE_DAYS * 86_400_000;
  const staleKeys = rules.filter((r) => new Date(r.lastReviewed).getTime() < staleCutoff).map((r) => r.key);
  if (staleKeys.length > 0) {
    alerts.push({
      ruleKey: "RULES_STALE",
      severity: "info",
      kind: "compliance",
      entityRef: "",
      title: "Some rules need a review",
      message: `These rules were last verified over a year ago: ${staleKeys.join(", ")}. Their thresholds may be outdated.`,
      action: "Re-verify the cited sources and update lastReviewed in the rule definitions.",
      citation: "Internal freshness policy",
    });
  }

  alerts.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (b.valueMinor ?? 0) - (a.valueMinor ?? 0),
  );
  return { alerts, errors };
}

export function applyDismissals(
  alerts: RuleAlert[],
  dismissals: Array<{ ruleKey: string; entityRef: string }>,
): { active: RuleAlert[]; dismissed: RuleAlert[] } {
  const keys = new Set(dismissals.map((d) => `${d.ruleKey} ${d.entityRef}`));
  const active: RuleAlert[] = [];
  const dismissed: RuleAlert[] = [];
  for (const alert of alerts) {
    (keys.has(`${alert.ruleKey} ${alert.entityRef}`) ? dismissed : active).push(alert);
  }
  return { active, dismissed };
}
```

- [x] **Step 7: Run tests, commit**

Run: `npm test` — expect all pass.

```bash
git add src/engine/rules/
git commit -m "feat: add rules engine core (types, verified thresholds, registry, dismissals)"
```

---

### Task 3: Settings page — profile editing

**Files:**
- Create: `src/lib/profile.ts`, `src/lib/validation/profile.ts`, `src/app/settings/page.tsx`, `src/app/settings/actions.ts`
- Modify: `src/components/nav.tsx` (add Settings link)

**Interfaces:**
- Consumes: `prisma`, `requireUserId`.
- Produces: `getOrCreateProfile(userId): Promise<ProfileView>` (maps the Prisma row to the engine type, creating defaults on first call) — the UI and snapshot assembler both use this; `updateProfile` / `addIncomeSource` / `removeIncomeSource` server actions.

- [x] **Step 1: Validation schema**

Create `src/lib/validation/profile.ts`:

```ts
import { z } from "zod";

export const incomeSourceInput = z.object({
  name: z.string().trim().min(1).max(60),
  amountMinor: z.coerce.number().int().safe().positive(),
  cadence: z.enum(["MONTHLY", "BIWEEKLY", "ANNUAL"]),
  kind: z.enum(["EMPLOYMENT", "SELF_EMPLOYMENT", "BENEFIT", "RENTAL", "OTHER"]),
});

export const profileInput = z.object({
  residency: z.string().regex(/^[A-Z]{2}$/),
  citizenships: z.string().trim().transform((s) =>
    s.split(",").map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)),
  ),
  filingStatus: z.enum(["SINGLE_ABROAD", "MFJ_ABROAD", "OTHER"]),
  marginalUSRatePct: z.coerce.number().int().min(0).max(50),
  dtcEligible: z.coerce.boolean().default(false),
  benefitPrograms: z.string().trim().transform((s) =>
    s.split(",").map((p) => p.trim().toUpperCase()).filter((p) => ["OW", "ODSP"].includes(p)),
  ),
  rdspIncomeTier: z.enum(["LOW", "HIGH", "UNKNOWN"]),
  rdspCarryForwardYears: z.coerce.number().int().min(0).max(20),
  rdspGrantsLifetimeMinor: z.coerce.number().int().safe().nonnegative(),
  rdspContribLifetimeMinor: z.coerce.number().int().safe().nonnegative(),
  tfsaRoomMinor: z.coerce.number().int().safe().nonnegative(),
  rrspRoomMinor: z.coerce.number().int().safe().nonnegative(),
  fhsaRoomMinor: z.coerce.number().int().safe().nonnegative(),
  nhtContributed: z.coerce.boolean().default(false),
});
```

- [x] **Step 2: Profile lib**

Create `src/lib/profile.ts`:

```ts
import type { IncomeSource, ProfileView } from "@/engine/rules/types";
import { prisma } from "@/lib/prisma";

export async function getOrCreateProfile(userId: string): Promise<ProfileView> {
  const row =
    (await prisma.profile.findUnique({ where: { userId } })) ??
    (await prisma.profile.create({ data: { userId } }));

  return {
    residency: row.residency,
    citizenships: row.citizenships,
    filingStatus: (["SINGLE_ABROAD", "MFJ_ABROAD", "OTHER"] as const).includes(
      row.filingStatus as never,
    )
      ? (row.filingStatus as ProfileView["filingStatus"])
      : "OTHER",
    marginalUSRatePct: row.marginalUSRatePct,
    dtcEligible: row.dtcEligible,
    benefitPrograms: row.benefitPrograms,
    rdspIncomeTier: (["LOW", "HIGH", "UNKNOWN"] as const).includes(row.rdspIncomeTier as never)
      ? (row.rdspIncomeTier as ProfileView["rdspIncomeTier"])
      : "UNKNOWN",
    rdspCarryForwardYears: row.rdspCarryForwardYears,
    rdspGrantsLifetimeMinor: row.rdspGrantsLifetimeMinor,
    rdspContribLifetimeMinor: row.rdspContribLifetimeMinor,
    tfsaRoomMinor: row.tfsaRoomMinor,
    rrspRoomMinor: row.rrspRoomMinor,
    fhsaRoomMinor: row.fhsaRoomMinor,
    nhtContributed: row.nhtContributed,
    incomeSources: (row.incomeSources as IncomeSource[] | null) ?? [],
  };
}
```

- [x] **Step 3: Actions**

Create `src/app/settings/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import type { IncomeSource } from "@/engine/rules/types";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { incomeSourceInput, profileInput } from "@/lib/validation/profile";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function updateProfile(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = profileInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue.path.join(".")}: ${issue.message}` };
  }
  await prisma.profile.upsert({
    where: { userId },
    update: parsed.data,
    create: { userId, ...parsed.data },
  });
  revalidatePath("/settings");
  revalidatePath("/money-finder");
  revalidatePath("/");
  return { ok: true };
}

export async function addIncomeSource(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = incomeSourceInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue.path.join(".")}: ${issue.message}` };
  }
  const row = await prisma.profile.upsert({ where: { userId }, update: {}, create: { userId } });
  const sources = ((row.incomeSources as IncomeSource[] | null) ?? []).concat(parsed.data);
  await prisma.profile.update({ where: { userId }, data: { incomeSources: sources } });
  revalidatePath("/settings");
  revalidatePath("/money-finder");
  return { ok: true };
}

export async function removeIncomeSource(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const index = Number(formData.get("index"));
  const row = await prisma.profile.findUnique({ where: { userId } });
  if (!row || !Number.isInteger(index)) return { ok: false, error: "Not found" };
  const sources = ((row.incomeSources as IncomeSource[] | null) ?? []).filter((_, i) => i !== index);
  await prisma.profile.update({ where: { userId }, data: { incomeSources: sources } });
  revalidatePath("/settings");
  revalidatePath("/money-finder");
  return { ok: true };
}
```

- [x] **Step 4: Settings page**

Create `src/app/settings/page.tsx`:

```tsx
import type { IncomeSource } from "@/engine/rules/types";
import { formatMinorUnits } from "@/engine/money";
import { getOrCreateProfile } from "@/lib/profile";
import { requireUserId } from "@/lib/require-user";
import { addIncomeSource, removeIncomeSource, updateProfile } from "./actions";

const input = "mt-1 w-full rounded border px-3 py-2 text-sm";
const label = "block text-sm";

export default async function SettingsPage() {
  const userId = await requireUserId();
  const profile = await getOrCreateProfile(userId);

  return (
    <main className="max-w-2xl space-y-10 py-8">
      <h1 className="text-xl font-semibold">Settings</h1>

      <form action={updateProfile} className="space-y-4">
        <h2 className="font-medium">Profile (drives every rule in Money Finder)</h2>
        <div className="grid grid-cols-2 gap-4">
          <label className={label}>Residency (2-letter)
            <input name="residency" defaultValue={profile.residency} pattern="[A-Z]{2}" className={input} />
          </label>
          <label className={label}>Citizenships (comma-sep)
            <input name="citizenships" defaultValue={profile.citizenships.join(", ")} className={input} />
          </label>
          <label className={label}>US filing status
            <select name="filingStatus" defaultValue={profile.filingStatus} className={input}>
              <option value="SINGLE_ABROAD">Single, living abroad</option>
              <option value="MFJ_ABROAD">Married filing jointly, abroad</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label className={label}>US marginal rate %
            <input name="marginalUSRatePct" type="number" defaultValue={profile.marginalUSRatePct} className={input} />
          </label>
          <label className={label}>RDSP income tier
            <select name="rdspIncomeTier" defaultValue={profile.rdspIncomeTier} className={input}>
              <option value="LOW">LOW (below CDSG family-income threshold)</option>
              <option value="HIGH">HIGH (above threshold)</option>
              <option value="UNKNOWN">Unknown</option>
            </select>
          </label>
          <label className={label}>RDSP carry-forward years (unused, last 10)
            <input name="rdspCarryForwardYears" type="number" defaultValue={profile.rdspCarryForwardYears} className={input} />
          </label>
          <label className={label}>RDSP lifetime grants received (cents)
            <input name="rdspGrantsLifetimeMinor" type="number" defaultValue={profile.rdspGrantsLifetimeMinor} className={input} />
          </label>
          <label className={label}>RDSP lifetime contributions (cents)
            <input name="rdspContribLifetimeMinor" type="number" defaultValue={profile.rdspContribLifetimeMinor} className={input} />
          </label>
          <label className={label}>TFSA room (cents, from CRA)
            <input name="tfsaRoomMinor" type="number" defaultValue={profile.tfsaRoomMinor} className={input} />
          </label>
          <label className={label}>RRSP room (cents, from CRA)
            <input name="rrspRoomMinor" type="number" defaultValue={profile.rrspRoomMinor} className={input} />
          </label>
          <label className={label}>FHSA room (cents, from CRA)
            <input name="fhsaRoomMinor" type="number" defaultValue={profile.fhsaRoomMinor} className={input} />
          </label>
          <label className={label}>Benefit programs (OW, ODSP)
            <input name="benefitPrograms" defaultValue={profile.benefitPrograms.join(", ")} className={input} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="dtcEligible" value="true" defaultChecked={profile.dtcEligible} />
          Disability Tax Credit eligible
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="nhtContributed" value="true" defaultChecked={profile.nhtContributed} />
          Has contributed to Jamaica NHT
        </label>
        <button type="submit" className="rounded bg-foreground px-4 py-2 text-sm text-background">Save profile</button>
      </form>

      <section>
        <h2 className="font-medium">Income sources</h2>
        <ul className="mt-2 divide-y rounded border">
          {profile.incomeSources.map((s: IncomeSource, i: number) => (
            <li key={i} className="flex items-center justify-between px-4 py-2 text-sm">
              <span>{s.name} · {s.kind} · {s.cadence.toLowerCase()}</span>
              <span className="flex items-center gap-3 tabular-nums">
                {formatMinorUnits(s.amountMinor, "CAD")}
                <form action={removeIncomeSource}>
                  <input type="hidden" name="index" value={i} />
                  <button type="submit" className="text-xs text-red-600">remove</button>
                </form>
              </span>
            </li>
          ))}
        </ul>
        <form action={addIncomeSource} className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
          <input name="name" placeholder="Name" required className="rounded border px-2 py-1" />
          <input name="amountMinor" placeholder="Amount (cents)" required className="rounded border px-2 py-1" />
          <select name="cadence" className="rounded border px-2 py-1">
            <option>MONTHLY</option><option>BIWEEKLY</option><option>ANNUAL</option>
          </select>
          <select name="kind" className="rounded border px-2 py-1">
            <option>EMPLOYMENT</option><option>SELF_EMPLOYMENT</option><option>BENEFIT</option><option>RENTAL</option><option>OTHER</option>
          </select>
          <button type="submit" className="rounded border px-2 py-1">Add</button>
        </form>
      </section>
    </main>
  );
}
```

- [x] **Step 5: Add Settings to the nav**

In `src/components/nav.tsx`, append `{ href: "/settings", label: "Settings" }` to the `links` array.

- [x] **Step 6: Verify + commit**

Run: `npm run dev` — edit and save each profile field, add and remove an income source, values persist across reloads. Then `npm test && npm run lint && npm run build`.

```bash
git add src/lib/profile.ts src/lib/validation/profile.ts src/app/settings/ src/components/nav.tsx
git commit -m "feat: add settings page with profile and income sources"
```

---

### Task 4: Snapshot assembler

**Files:**
- Create: `src/lib/snapshot.ts`

**Interfaces:**
- Consumes: `prisma`, `accountBalance` (`@/engine/balance`).
- Produces: `buildSnapshot(userId: string, today: string): Promise<FinancialSnapshot>` — the single bridge between the database and the pure rules engine.

- [x] **Step 1: Implement**

Create `src/lib/snapshot.ts`:

```ts
import { accountBalance } from "@/engine/balance";
import type { FxRateInput } from "@/engine/fx";
import type { Currency } from "@/engine/money";
import type { AccountView, FinancialSnapshot } from "@/engine/rules/types";
import { prisma } from "@/lib/prisma";

export async function buildSnapshot(userId: string, today: string): Promise<FinancialSnapshot> {
  const [accounts, fxRates] = await Promise.all([
    prisma.financialAccount.findMany({
      where: { userId },
      include: { holdings: true, transactions: true, snapshots: true },
      orderBy: { name: "asc" },
    }),
    prisma.fxRate.findMany({ where: { userId } }),
  ]);

  const accountViews: AccountView[] = accounts.map((a) => {
    const txs = a.transactions.map((t) => ({
      id: t.id,
      type: t.type,
      amountMinor: t.amountMinor,
      currency: t.currency,
      date: t.date.toISOString(),
    }));
    const snaps = a.snapshots.map((s) => ({ balanceMinor: s.balanceMinor, asOf: s.asOf.toISOString() }));
    const balance = accountBalance(
      txs.map((t) => ({ type: t.type, amountMinor: t.amountMinor, date: t.date })),
      snaps,
    );
    return {
      id: a.id,
      type: a.type,
      name: a.name,
      institution: a.institution,
      country: a.country,
      currency: a.currency as Currency,
      isUSSitus: a.isUSSitus,
      balanceMinor: balance.balanceMinor,
      balanceAsOf: balance.asOf,
      holdings: a.holdings.map((h) => ({
        id: h.id,
        symbol: h.symbol,
        name: h.name,
        domicileCountry: h.domicileCountry,
        quantity: Number(h.quantity),
        bookCostMinor: h.bookCostMinor,
        lastPriceMinor: h.lastPriceMinor,
        priceAsOf: h.priceAsOf.toISOString(),
      })),
      transactions: txs,
      snapshots: snaps,
    };
  });

  const rates: FxRateInput[] = fxRates.map((r) => ({
    base: r.base as Currency,
    quote: r.quote as Currency,
    rate: Number(r.rate),
    asOf: r.asOf.toISOString(),
  }));

  return { today, accounts: accountViews, fxRates: rates };
}
```

- [x] **Step 2: Verify + commit**

Run: `npm run build` (type-checks the bridge against both Prisma and engine types).

```bash
git add src/lib/snapshot.ts
git commit -m "feat: add financial snapshot assembler for the rules engine"
```

---

### Task 5: US compliance rules — FBAR + Form 8938

**Files:**
- Create: `src/engine/rules/us-reporting.ts`, `src/engine/rules/us-reporting.test.ts`

**Interfaces:**
- Consumes: `netWorthSeries` (`../networth`), `convertMinor` (`../fx`), `THRESHOLDS`, types, fixtures.
- Produces: `fbarRule: Rule`, `form8938Rule: Rule`, and the shared helper `maxForeignAggregateUsd(snapshot): { maxMinor: number; currentMinor: number }` (also used by tests). The FBAR rule ALWAYS returns exactly one alert (SAFE = info, TRIGGERED = warning) so the status is permanently visible per the spec.

- [x] **Step 1: Write the failing test**

Create `src/engine/rules/us-reporting.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeAccount, makeProfile, makeSnapshot } from "./fixtures";
import { fbarRule, form8938Rule, maxForeignAggregateUsd } from "./us-reporting";

const profile = makeProfile();

describe("maxForeignAggregateUsd", () => {
  it("takes the max over the year of forward-filled snapshots plus today's live balances", () => {
    const account = makeAccount({
      currency: "CAD",
      balanceMinor: 700_000, // live today: 7,000 CAD = 5,000 USD
      snapshots: [
        { balanceMinor: 2_100_000, asOf: "2026-03-01" }, // 21,000 CAD = 15,000 USD peak
        { balanceMinor: 700_000, asOf: "2026-06-01" },
      ],
    });
    const snapshot = makeSnapshot([account]);
    const { maxMinor, currentMinor } = maxForeignAggregateUsd(snapshot);
    expect(maxMinor).toBe(1_500_000);
    expect(currentMinor).toBe(500_000);
  });

  it("ignores US-situs accounts", () => {
    const us = makeAccount({ isUSSitus: true, currency: "USD", balanceMinor: 5_000_000 });
    const snapshot = makeSnapshot([us]);
    expect(maxForeignAggregateUsd(snapshot).maxMinor).toBe(0);
  });
});

describe("fbarRule", () => {
  it("reports TRIGGERED as a warning when the max aggregate exceeds $10,000 USD", () => {
    const account = makeAccount({
      currency: "USD",
      balanceMinor: 1_100_000,
      snapshots: [{ balanceMinor: 1_100_000, asOf: "2026-02-01" }],
    });
    const alerts = fbarRule.evaluate(profile, makeSnapshot([account]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].message).toContain("FinCEN 114");
  });

  it("reports SAFE as info when under the threshold", () => {
    const account = makeAccount({ currency: "CAD", balanceMinor: 100_000 });
    const alerts = fbarRule.evaluate(profile, makeSnapshot([account]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("info");
    expect(alerts[0].title).toContain("SAFE");
  });
});

describe("form8938Rule", () => {
  it("is silent well under the single-abroad thresholds", () => {
    const account = makeAccount({ currency: "USD", balanceMinor: 1_000_000 });
    expect(form8938Rule.evaluate(profile, makeSnapshot([account]))).toHaveLength(0);
  });

  it("warns when the any-time aggregate crosses $300k (single abroad)", () => {
    const account = makeAccount({
      currency: "USD",
      balanceMinor: 31_000_000,
      snapshots: [{ balanceMinor: 31_000_000, asOf: "2026-04-01" }],
    });
    const alerts = form8938Rule.evaluate(profile, makeSnapshot([account]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].message).toContain("8938");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test` — expect FAIL (module not found).

- [x] **Step 3: Implement**

Create `src/engine/rules/us-reporting.ts`:

```ts
import { convertMinor } from "../fx";
import { formatMinorUnits } from "../money";
import { netWorthSeries } from "../networth";
import { THRESHOLDS } from "./thresholds";
import type { FinancialSnapshot, Rule } from "./types";
import { currentYear } from "./types";

export function maxForeignAggregateUsd(snapshot: FinancialSnapshot): {
  maxMinor: number;
  currentMinor: number;
} {
  const foreign = snapshot.accounts.filter((a) => !a.isUSSitus);
  const snapRows = foreign.flatMap((a) =>
    a.snapshots.map((s) => ({
      accountId: a.id,
      balanceMinor: s.balanceMinor,
      currency: a.currency,
      asOf: s.asOf,
    })),
  );
  const series = netWorthSeries(
    snapRows,
    "USD",
    snapshot.fxRates,
    `${currentYear(snapshot.today)}-01-01`,
    snapshot.today,
  );
  const currentMinor = foreign.reduce(
    (sum, a) => sum + convertMinor(a.balanceMinor, a.currency, "USD", snapshot.fxRates),
    0,
  );
  const maxMinor = Math.max(currentMinor, 0, ...series.map((p) => p.totalMinor));
  return { maxMinor, currentMinor };
}

export const fbarRule: Rule = {
  key: "FBAR",
  jurisdiction: "US",
  kind: "compliance",
  citation: "31 CFR 1010.350 — FinCEN Form 114",
  lastReviewed: "2026-08-14",
  evaluate(_profile, snapshot) {
    const { maxMinor, currentMinor } = maxForeignAggregateUsd(snapshot);
    const triggered = maxMinor > THRESHOLDS.FBAR_AGGREGATE_USD;
    return [
      {
        ruleKey: "FBAR",
        severity: triggered ? "warning" : "info",
        kind: "compliance",
        entityRef: "",
        title: triggered ? "FBAR: TRIGGERED this year" : "FBAR: SAFE so far this year",
        message: triggered
          ? `Your non-US accounts peaked at ${formatMinorUnits(maxMinor, "USD")} (now ${formatMinorUnits(currentMinor, "USD")}) — over the $10,000 aggregate, so FinCEN 114 is required for this calendar year.`
          : `Non-US aggregate peak so far: ${formatMinorUnits(maxMinor, "USD")} of the $10,000 USD threshold.`,
        action: triggered
          ? "File FinCEN Form 114 with next year's US filings — the obligation is already locked in for this year."
          : "No filing triggered yet. The meter watches the max, not the current balance — crossing once is enough.",
        citation: "31 CFR 1010.350",
        valueMinor: maxMinor,
        valueCurrency: "USD",
      },
    ];
  },
};

export const form8938Rule: Rule = {
  key: "FORM_8938",
  jurisdiction: "US",
  kind: "compliance",
  citation: "26 CFR 1.6038D-2 — IRS Form 8938 (FATCA)",
  lastReviewed: "2026-08-14",
  evaluate(profile, snapshot) {
    const t = THRESHOLDS.FORM_8938[profile.filingStatus];
    const { maxMinor, currentMinor } = maxForeignAggregateUsd(snapshot);
    const overAnyTime = maxMinor > t.anyTimeUsd;
    const nearYearEnd = currentMinor > t.yearEndUsd;
    if (!overAnyTime && !nearYearEnd) return [];
    return [
      {
        ruleKey: "FORM_8938",
        severity: "warning",
        kind: "compliance",
        entityRef: "",
        title: "Form 8938 threshold status",
        message: overAnyTime
          ? `Foreign financial assets peaked at ${formatMinorUnits(maxMinor, "USD")} — over the ${formatMinorUnits(t.anyTimeUsd, "USD")} any-time threshold for your filing status. Form 8938 applies this year.`
          : `Current foreign assets ${formatMinorUnits(currentMinor, "USD")} exceed the ${formatMinorUnits(t.yearEndUsd, "USD")} year-end threshold — if this holds to Dec 31, Form 8938 applies.`,
        action: "Add Form 8938 to this year's US return prep. Thresholds differ by filing status — confirm yours in Settings.",
        citation: "26 CFR 1.6038D-2",
        valueMinor: maxMinor,
        valueCurrency: "USD",
      },
    ];
  },
};
```

- [x] **Step 4: Run tests (verify the math by hand first if anything fails), commit**

Run: `npm test` — expect pass.

```bash
git add src/engine/rules/us-reporting.*
git commit -m "feat: add FBAR and Form 8938 rules with yearly max aggregation"
```

---

### Task 6: PFIC, Roth freeze, TFSA reality, T1135 rules

**Files:**
- Create: `src/engine/rules/cross-border.ts`, `src/engine/rules/cross-border.test.ts`

**Interfaces:**
- Consumes: types, fixtures, `THRESHOLDS`, `convertMinor`, `formatMinorUnits`, `txsThisYear`.
- Produces: `pficRule`, `rothFreezeRule`, `tfsaDragRule`, `tfsaWithholdingRule`, `t1135Rule` (all `Rule`).

- [x] **Step 1: Write the failing test**

Create `src/engine/rules/cross-border.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeAccount, makeHolding, makeProfile, makeSnapshot, makeTx } from "./fixtures";
import { pficRule, rothFreezeRule, t1135Rule, tfsaDragRule, tfsaWithholdingRule } from "./cross-border";

const profile = makeProfile();

describe("pficRule (spec acceptance)", () => {
  const veqt = makeHolding({ symbol: "VEQT.TO", domicileCountry: "CA" });

  it("flags a Canadian-listed fund in a TFSA as CRITICAL", () => {
    const tfsa = makeAccount({ type: "TFSA", holdings: [veqt] });
    const alerts = pficRule.evaluate(profile, makeSnapshot([tfsa]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[0].message).toContain("VEQT.TO");
    expect(alerts[0].entityRef).toBe(veqt.id);
  });

  it("is silent for the same holding in an RRSP", () => {
    const rrsp = makeAccount({ type: "RRSP", holdings: [makeHolding({ symbol: "VEQT.TO" })] });
    expect(pficRule.evaluate(profile, makeSnapshot([rrsp]))).toHaveLength(0);
  });

  it("catches US-domiciled-flag mismatches by ticker suffix", () => {
    const tfsa = makeAccount({
      type: "TFSA",
      holdings: [makeHolding({ symbol: "XYZ.NE", domicileCountry: "US" })],
    });
    expect(pficRule.evaluate(profile, makeSnapshot([tfsa]))).toHaveLength(1);
  });
});

describe("rothFreezeRule", () => {
  it("flags a logged Roth contribution while resident in Canada", () => {
    const roth = makeAccount({
      type: "ROTH_IRA",
      isUSSitus: true,
      currency: "USD",
      transactions: [makeTx({ type: "CONTRIBUTION", currency: "USD", date: "2026-05-01" })],
    });
    const alerts = rothFreezeRule.evaluate(profile, makeSnapshot([roth]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("critical");
  });

  it("is silent when residency is not CA", () => {
    const roth = makeAccount({
      type: "ROTH_IRA",
      transactions: [makeTx({ type: "CONTRIBUTION" })],
    });
    const usProfile = makeProfile({ residency: "US" });
    expect(rothFreezeRule.evaluate(usProfile, makeSnapshot([roth]))).toHaveLength(0);
  });
});

describe("tfsaDragRule", () => {
  it("annotates every TFSA and estimates drag from this year's income transactions", () => {
    const tfsa = makeAccount({
      type: "TFSA",
      transactions: [
        makeTx({ type: "DIVIDEND", amountMinor: 100_000, date: "2026-03-01" }),
        makeTx({ type: "INTEREST", amountMinor: 20_000, date: "2026-04-01" }),
        makeTx({ type: "DIVIDEND", amountMinor: 50_000, date: "2025-03-01" }), // prior year — excluded
      ],
    });
    const alerts = tfsaDragRule.evaluate(profile, makeSnapshot([tfsa]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].valueMinor).toBe(28_800); // (100000+20000) * 24%
    expect(alerts[0].message).not.toContain("tax-free");
  });
});

describe("tfsaWithholdingRule", () => {
  it("flags US-domiciled holdings inside a TFSA", () => {
    const tfsa = makeAccount({
      type: "TFSA",
      holdings: [makeHolding({ symbol: "VTI", domicileCountry: "US" })],
    });
    const alerts = tfsaWithholdingRule.evaluate(profile, makeSnapshot([tfsa]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain("15%");
  });
});

describe("t1135Rule", () => {
  it("warns when non-registered foreign cost exceeds CAD $100k", () => {
    const nonReg = makeAccount({
      type: "NON_REGISTERED",
      holdings: [
        makeHolding({ symbol: "VTI", domicileCountry: "US", bookCostMinor: 8_000_000 }), // USD? cost tracked in account currency CAD here
        makeHolding({ symbol: "AAPL", domicileCountry: "US", bookCostMinor: 3_000_000 }),
      ],
    });
    const alerts = t1135Rule.evaluate(profile, makeSnapshot([nonReg]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
  });

  it("ignores registered accounts and CA-domiciled holdings", () => {
    const rrsp = makeAccount({
      type: "RRSP",
      holdings: [makeHolding({ domicileCountry: "US", bookCostMinor: 20_000_000 })],
    });
    const nonRegCa = makeAccount({
      type: "NON_REGISTERED",
      holdings: [makeHolding({ domicileCountry: "CA", bookCostMinor: 20_000_000 })],
    });
    expect(t1135Rule.evaluate(profile, makeSnapshot([rrsp, nonRegCa]))).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test` — expect FAIL.

- [x] **Step 3: Implement**

Create `src/engine/rules/cross-border.ts`:

```ts
import { convertMinor } from "../fx";
import { formatMinorUnits } from "../money";
import { THRESHOLDS } from "./thresholds";
import type { Rule } from "./types";
import { txsThisYear } from "./types";

function isPficSuspect(symbol: string, domicileCountry: string): boolean {
  return (
    domicileCountry === "CA" ||
    THRESHOLDS.PFIC_TICKER_SUFFIXES.some((suffix) => symbol.toUpperCase().endsWith(suffix))
  );
}

export const pficRule: Rule = {
  key: "PFIC",
  jurisdiction: "US",
  kind: "compliance",
  citation: "IRC §1291–1298; IRS Form 8621",
  lastReviewed: "2026-08-14",
  evaluate(_profile, snapshot) {
    return snapshot.accounts
      .filter((a) => a.type !== "RRSP")
      .flatMap((account) =>
        account.holdings
          .filter((h) => isPficSuspect(h.symbol, h.domicileCountry))
          .map((h) => ({
            ruleKey: "PFIC",
            severity: "critical" as const,
            kind: "compliance" as const,
            entityRef: h.id,
            title: `PFIC risk: ${h.symbol} in ${account.name}`,
            message: `${h.symbol} (${h.name}) in ${account.name} looks like a Canadian-domiciled fund held outside an RRSP — a PFIC for US tax purposes, with punitive taxation and Form 8621 per fund, per year.`,
            action: "Documented fix: sell and replace with a US-listed equivalent, or move exposure inside the RRSP. Form 8621 applies for any year it was held. Verify with your cross-border accountant.",
            citation: "IRC §1291–1298; Form 8621",
          })),
      );
  },
};

export const rothFreezeRule: Rule = {
  key: "ROTH_FREEZE",
  jurisdiction: "CROSS",
  kind: "compliance",
  citation: "Canada–US Tax Treaty Art. XVIII(3.5); CRA Income Tax Folio S5-F3-C1",
  lastReviewed: "2026-08-14",
  evaluate(profile, snapshot) {
    if (profile.residency !== "CA") return [];
    return snapshot.accounts
      .filter((a) => a.type === "ROTH_IRA")
      .flatMap((account) =>
        account.transactions
          .filter((t) => t.type === "CONTRIBUTION")
          .map((t) => ({
            ruleKey: "ROTH_FREEZE",
            severity: "critical" as const,
            kind: "compliance" as const,
            entityRef: t.id,
            title: "Roth contribution logged while Canadian-resident",
            message: `A ${formatMinorUnits(t.amountMinor, "USD")} contribution to ${account.name} dated ${t.date.slice(0, 10)} is recorded. Contributions while resident in Canada create "Canadian contributions" that taint the treaty election — the Roth's tax-free status in Canada can be permanently lost.`,
            action: "If this is a data-entry error, delete the transaction. If it really happened, contact your cross-border accountant about remediation immediately.",
            citation: "Treaty Art. XVIII(3.5); CRA Folio S5-F3-C1",
          })),
      );
  },
};

export const tfsaDragRule: Rule = {
  key: "TFSA_US_DRAG",
  jurisdiction: "CROSS",
  kind: "compliance",
  citation: "TFSAs are not covered by the treaty's pension article; growth is US-taxable for US persons",
  lastReviewed: "2026-08-14",
  evaluate(profile, snapshot) {
    if (!profile.citizenships.includes("US")) return [];
    return snapshot.accounts
      .filter((a) => a.type === "TFSA")
      .map((account) => {
        const incomeThisYear = txsThisYear(account, snapshot.today)
          .filter((t) => t.type === "DIVIDEND" || t.type === "INTEREST")
          .reduce((sum, t) => sum + t.amountMinor, 0);
        const drag = Math.round((incomeThisYear * profile.marginalUSRatePct) / 100);
        return {
          ruleKey: "TFSA_US_DRAG",
          severity: "info" as const,
          kind: "compliance" as const,
          entityRef: account.id,
          title: `${account.name}: growth is US-taxable`,
          message: `For a US person this account is NOT sheltered — the IRS taxes its growth annually. Logged income this year: ${formatMinorUnits(incomeThisYear, account.currency)}; estimated US tax drag at your ${profile.marginalUSRatePct}% marginal rate: ${formatMinorUnits(drag, account.currency)}.`,
          action: "Include this account's income on your US return. Consider whether RRSP or non-registered placement beats it after US tax.",
          citation: "US–Canada treaty scope; IRS treatment of TFSAs",
          valueMinor: drag,
          valueCurrency: account.currency,
        };
      });
  },
};

export const tfsaWithholdingRule: Rule = {
  key: "TFSA_US_WITHHOLDING",
  jurisdiction: "CROSS",
  kind: "compliance",
  citation: "US–Canada Tax Treaty Art. X — 15% withholding not recoverable inside a TFSA",
  lastReviewed: "2026-08-14",
  evaluate(_profile, snapshot) {
    return snapshot.accounts
      .filter((a) => a.type === "TFSA")
      .flatMap((account) =>
        account.holdings
          .filter((h) => h.domicileCountry === "US")
          .map((h) => ({
            ruleKey: "TFSA_US_WITHHOLDING",
            severity: "info" as const,
            kind: "compliance" as const,
            entityRef: h.id,
            title: `${h.symbol} in ${account.name}: 15% dividend withholding`,
            message: `US dividends inside a TFSA suffer ${THRESHOLDS.TFSA_US_DIVIDEND_WITHHOLDING_PCT}% withholding that can never be recovered (no foreign tax credit applies inside a TFSA).`,
            action: "US dividend payers are usually better placed in an RRSP (treaty-exempt) or non-registered (credit available).",
            citation: "Treaty Art. X",
          })),
      );
  },
};

export const t1135Rule: Rule = {
  key: "T1135",
  jurisdiction: "CA",
  kind: "compliance",
  citation: "ITA s.233.3 — Form T1135 for specified foreign property with cost > CAD $100,000",
  lastReviewed: "2026-08-14",
  evaluate(_profile, snapshot) {
    const NON_REGISTERED_TYPES = new Set(["NON_REGISTERED", "CRYPTO"]);
    let costCad = 0;
    for (const account of snapshot.accounts) {
      if (!NON_REGISTERED_TYPES.has(account.type)) continue;
      for (const h of account.holdings) {
        if (h.domicileCountry === "CA") continue;
        const cost = h.bookCostMinor ?? Math.round(h.quantity * h.lastPriceMinor);
        costCad += convertMinor(cost, account.currency, "CAD", snapshot.fxRates);
      }
    }
    if (costCad <= THRESHOLDS.T1135_COST_CAD) return [];
    return [
      {
        ruleKey: "T1135",
        severity: "warning",
        kind: "compliance",
        entityRef: "",
        title: "T1135 filing likely required",
        message: `Cost of foreign property in non-registered accounts ≈ ${formatMinorUnits(costCad, "CAD")}, over the CAD $100,000 threshold. (Heuristic: non-CA-domiciled holdings incl. crypto — classification nuances exist.)`,
        action: "Confirm T1135 scope with your accountant before the filing deadline — penalties for missing it are steep.",
        citation: "ITA s.233.3",
        valueMinor: costCad,
        valueCurrency: "CAD",
      },
    ];
  },
};
```

- [x] **Step 4: Run tests, commit**

Run: `npm test` — expect pass.

```bash
git add src/engine/rules/cross-border.*
git commit -m "feat: add PFIC, Roth freeze, TFSA reality, and T1135 rules"
```

---

### Task 7: Contribution-room guards + stale-data rule

**Files:**
- Create: `src/engine/rules/rooms.ts`, `src/engine/rules/rooms.test.ts`

**Interfaces:**
- Consumes: types, fixtures, `THRESHOLDS`, `formatMinorUnits`, `txsThisYear`.
- Produces: `tfsaRoomRule`, `rrspRoomRule`, `fhsaRoomRule`, `rdspLifetimeRule`, `staleDataRule` (all `Rule`). Room semantics: profile room figures are **as of Jan 1 of the current year** (CRA numbers); the rule subtracts this year's logged CONTRIBUTIONs to accounts of the matching type.

- [x] **Step 1: Write the failing test**

Create `src/engine/rules/rooms.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeAccount, makeHolding, makeProfile, makeSnapshot, makeTx } from "./fixtures";
import { fhsaRoomRule, rdspLifetimeRule, staleDataRule, tfsaRoomRule } from "./rooms";

describe("tfsaRoomRule", () => {
  it("shows remaining room as an opportunity", () => {
    const profile = makeProfile({ tfsaRoomMinor: 1_000_000 }); // $10,000 as of Jan 1
    const tfsa = makeAccount({
      type: "TFSA",
      transactions: [makeTx({ type: "CONTRIBUTION", amountMinor: 400_000, date: "2026-02-01" })],
    });
    const alerts = tfsaRoomRule.evaluate(profile, makeSnapshot([tfsa]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("opportunity");
    expect(alerts[0].valueMinor).toBe(600_000);
  });

  it("goes critical on over-contribution", () => {
    const profile = makeProfile({ tfsaRoomMinor: 100_000 });
    const tfsa = makeAccount({
      type: "TFSA",
      transactions: [makeTx({ type: "CONTRIBUTION", amountMinor: 300_000, date: "2026-02-01" })],
    });
    const alerts = tfsaRoomRule.evaluate(profile, makeSnapshot([tfsa]));
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[0].message).toContain("1%");
  });

  it("is silent when no room figure was entered", () => {
    const alerts = tfsaRoomRule.evaluate(makeProfile(), makeSnapshot([makeAccount({ type: "TFSA" })]));
    expect(alerts).toHaveLength(0);
  });
});

describe("fhsaRoomRule", () => {
  it("also enforces the $8k annual cap independent of entered room", () => {
    const profile = makeProfile({ fhsaRoomMinor: 2_000_000 });
    const fhsa = makeAccount({
      type: "FHSA",
      transactions: [makeTx({ type: "CONTRIBUTION", amountMinor: 900_000, date: "2026-03-01" })],
    });
    const alerts = fhsaRoomRule.evaluate(profile, makeSnapshot([fhsa]));
    expect(alerts.some((a) => a.severity === "critical" && a.message.includes("annual"))).toBe(true);
  });
});

describe("rdspLifetimeRule", () => {
  it("goes critical when lifetime contributions would exceed $200k", () => {
    const profile = makeProfile({ rdspContribLifetimeMinor: 19_950_000 });
    const rdsp = makeAccount({
      type: "RDSP",
      transactions: [makeTx({ type: "CONTRIBUTION", amountMinor: 100_000, date: "2026-02-01" })],
    });
    const alerts = rdspLifetimeRule.evaluate(profile, makeSnapshot([rdsp]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("critical");
  });
});

describe("staleDataRule", () => {
  it("flags prices and FX older than 30 days", () => {
    const account = makeAccount({
      holdings: [makeHolding({ priceAsOf: "2026-05-01" })], // 105 days before 2026-08-14
    });
    const snapshot = makeSnapshot([account], {
      fxRates: [{ base: "USD", quote: "CAD", rate: 1.4, asOf: "2026-06-01" }],
    });
    const alerts = staleDataRule.evaluate(makeProfile(), snapshot);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toMatch(/1 holding price/);
    expect(alerts[0].message).toMatch(/1 FX rate/);
  });

  it("is silent when everything is fresh", () => {
    const account = makeAccount({ holdings: [makeHolding({ priceAsOf: "2026-08-10" })] });
    const snapshot = makeSnapshot([account], {
      fxRates: [{ base: "USD", quote: "CAD", rate: 1.4, asOf: "2026-08-10" }],
    });
    expect(staleDataRule.evaluate(makeProfile(), snapshot)).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test` — expect FAIL.

- [x] **Step 3: Implement**

Create `src/engine/rules/rooms.ts`:

```ts
import { formatMinorUnits } from "../money";
import { THRESHOLDS } from "./thresholds";
import type { FinancialSnapshot, ProfileView, Rule, RuleAlert } from "./types";
import { txsThisYear } from "./types";

function contributionsThisYear(snapshot: FinancialSnapshot, accountType: string): number {
  return snapshot.accounts
    .filter((a) => a.type === accountType)
    .flatMap((a) => txsThisYear(a, snapshot.today, "CONTRIBUTION"))
    .reduce((sum, t) => sum + t.amountMinor, 0);
}

function roomAlert(
  key: string,
  label: string,
  roomJan1: number,
  contributed: number,
  citation: string,
  extraAction = "",
): RuleAlert[] {
  if (roomJan1 <= 0) return []; // no CRA figure entered — nothing to guard
  const remaining = roomJan1 - contributed;
  if (remaining >= 0) {
    return [
      {
        ruleKey: key,
        severity: "info",
        kind: "opportunity",
        entityRef: "",
        title: `${label}: ${formatMinorUnits(remaining, "CAD")} of room left`,
        message: `Room entered for Jan 1 minus ${formatMinorUnits(contributed, "CAD")} contributed this year leaves ${formatMinorUnits(remaining, "CAD")}.`,
        action: `Contribute up to ${formatMinorUnits(remaining, "CAD")} without penalty. ${extraAction}`.trim(),
        citation,
        valueMinor: remaining,
        valueCurrency: "CAD",
      },
    ];
  }
  return [
    {
      ruleKey: key,
      severity: "critical",
      kind: "compliance",
      entityRef: "",
      title: `${label}: OVER-CONTRIBUTED by ${formatMinorUnits(-remaining, "CAD")}`,
      message: `Contributions this year exceed your entered room. Over-contributions are penalized at ${THRESHOLDS.OVERCONTRIBUTION_PENALTY_PCT_PER_MONTH}%/month on the excess until withdrawn.`,
      action: "Verify your current room on CRA MyAccount (it may be stale in Settings). If truly over, withdraw the excess now.",
      citation,
      valueMinor: -remaining,
      valueCurrency: "CAD",
    },
  ];
}

export const tfsaRoomRule: Rule = {
  key: "TFSA_ROOM",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "ITA s.207.02 — TFSA over-contribution tax",
  lastReviewed: "2026-08-14",
  evaluate(profile, snapshot) {
    return roomAlert(
      "TFSA_ROOM",
      "TFSA",
      profile.tfsaRoomMinor,
      contributionsThisYear(snapshot, "TFSA"),
      "ITA s.207.02",
      "Note: for US persons TFSA growth is still US-taxable (see the TFSA reality alert).",
    );
  },
};

export const rrspRoomRule: Rule = {
  key: "RRSP_ROOM",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "ITA s.204.1 — RRSP over-contribution tax ($2,000 grace not modeled)",
  lastReviewed: "2026-08-14",
  evaluate(profile, snapshot) {
    return roomAlert(
      "RRSP_ROOM",
      "RRSP",
      profile.rrspRoomMinor,
      contributionsThisYear(snapshot, "RRSP"),
      "ITA s.204.1",
      "Deduction limit from your latest Notice of Assessment; contributions in the first 60 days of next year also count for this year.",
    );
  },
};

export const fhsaRoomRule: Rule = {
  key: "FHSA_ROOM",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "ITA s.146.6 — FHSA: $8,000/yr, $40,000 lifetime",
  lastReviewed: "2026-08-14",
  evaluate(profile, snapshot) {
    const contributed = contributionsThisYear(snapshot, "FHSA");
    const alerts = roomAlert("FHSA_ROOM", "FHSA", profile.fhsaRoomMinor, contributed, "ITA s.146.6");
    if (contributed > THRESHOLDS.FHSA.ANNUAL_CAP) {
      alerts.push({
        ruleKey: "FHSA_ROOM",
        severity: "critical",
        kind: "compliance",
        entityRef: "annual-cap",
        title: `FHSA annual cap exceeded`,
        message: `${formatMinorUnits(contributed, "CAD")} contributed this year exceeds the ${formatMinorUnits(THRESHOLDS.FHSA.ANNUAL_CAP, "CAD")} annual FHSA limit (carry-forward can raise your personal limit — verify).`,
        action: "Check your FHSA participation room on CRA MyAccount; withdraw any true excess.",
        citation: "ITA s.146.6",
      });
    }
    return alerts;
  },
};

export const rdspLifetimeRule: Rule = {
  key: "RDSP_LIFETIME",
  jurisdiction: "CA",
  kind: "compliance",
  citation: "Canada Disability Savings Act — $200,000 lifetime contribution limit",
  lastReviewed: "2026-08-14",
  evaluate(profile, snapshot) {
    const total = profile.rdspContribLifetimeMinor + contributionsThisYear(snapshot, "RDSP");
    if (total <= THRESHOLDS.CDSG.LIFETIME_CONTRIB_MAX) return [];
    return [
      {
        ruleKey: "RDSP_LIFETIME",
        severity: "critical",
        kind: "compliance",
        entityRef: "",
        title: "RDSP lifetime contribution limit exceeded",
        message: `Lifetime contributions ≈ ${formatMinorUnits(total, "CAD")}, over the ${formatMinorUnits(THRESHOLDS.CDSG.LIFETIME_CONTRIB_MAX, "CAD")} cap.`,
        action: "Verify lifetime totals with ESDC/your issuer before contributing more.",
        citation: "Canada Disability Savings Act",
      },
    ];
  },
};

export const staleDataRule: Rule = {
  key: "STALE_DATA",
  jurisdiction: "CROSS",
  kind: "compliance",
  citation: "Internal data-freshness policy (30 days)",
  lastReviewed: "2026-08-14",
  evaluate(_profile, snapshot) {
    const cutoff = new Date(snapshot.today).getTime() - THRESHOLDS.STALE_DATA_DAYS * 86_400_000;
    const stalePrices = snapshot.accounts
      .flatMap((a) => a.holdings)
      .filter((h) => new Date(h.priceAsOf).getTime() < cutoff).length;
    const staleFx = snapshot.fxRates.filter((r) => new Date(r.asOf).getTime() < cutoff).length;
    if (stalePrices === 0 && staleFx === 0) return [];
    return [
      {
        ruleKey: "STALE_DATA",
        severity: "info",
        kind: "compliance",
        entityRef: "",
        title: "Stale prices or FX rates",
        message: `${stalePrices} holding price(s) and ${staleFx} FX rate(s) are older than ${THRESHOLDS.STALE_DATA_DAYS} days — net worth, FBAR aggregates, and thresholds silently rot on stale inputs.`,
        action: "Update holding prices on their account pages and refresh FX via import.",
        citation: "Internal policy",
      },
    ];
  },
};
```

- [x] **Step 4: Run tests, commit**

Run: `npm test` — expect pass.

```bash
git add src/engine/rules/rooms.*
git commit -m "feat: add contribution-room guards and stale-data rule"
```

---

### Task 8: RDSP optimizer — CDSG + CDSB

The highest-dollar rule in the app. The CDSG math must satisfy the spec's acceptance case exactly.

**Files:**
- Create: `src/engine/rules/rdsp.ts`, `src/engine/rules/rdsp.test.ts`

**Interfaces:**
- Consumes: types, fixtures, `THRESHOLDS`, `formatMinorUnits`, `txsThisYear`.
- Produces: `cdsgRule`, `cdsbRule` (`Rule`), plus the exported pure helper `cdsgPlan(profile, contributedThisYearMinor)` → `{ optimalContributionMinor; grantAtOptimalMinor; additionalGrantMinor; effectiveMatchPct }` (tested directly).

**CDSG model** (documented simplification): entitlement bands scale by `1 + rdspCarryForwardYears` (carry-forward pays at the highest rates first); the grant payable in one year is capped at `ANNUAL_MAX_WITH_CARRYFORWARD` ($10,500) and by lifetime room (`$70,000 − grants received`); contributions are capped by lifetime contribution room. `UNKNOWN` tier is treated as HIGH with an action telling the user to set their tier (understating is the safe direction).

- [x] **Step 1: Write the failing test**

Create `src/engine/rules/rdsp.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeAccount, makeProfile, makeSnapshot, makeTx } from "./fixtures";
import { cdsbRule, cdsgPlan, cdsgRule } from "./rdsp";

describe("cdsgPlan", () => {
  it("spec acceptance: low tier, 1 carry-forward year, $0 contributed", () => {
    const profile = makeProfile({ rdspIncomeTier: "LOW", rdspCarryForwardYears: 1 });
    const plan = cdsgPlan(profile, 0);
    // Bands ×2 years: 300% on $1,000 → $3,000; 200% on $2,000 → $4,000. Total $7,000 ≤ $10,500 cap.
    expect(plan.optimalContributionMinor).toBe(300_000);
    expect(plan.grantAtOptimalMinor).toBe(700_000);
    expect(plan.additionalGrantMinor).toBe(700_000);
    expect(plan.effectiveMatchPct).toBe(233);
  });

  it("no carry-forward, low tier: $1,500 → $3,500", () => {
    const plan = cdsgPlan(makeProfile({ rdspIncomeTier: "LOW" }), 0);
    expect(plan.optimalContributionMinor).toBe(150_000);
    expect(plan.grantAtOptimalMinor).toBe(350_000);
  });

  it("caps the payable grant at $10,500 with heavy carry-forward", () => {
    const plan = cdsgPlan(makeProfile({ rdspIncomeTier: "LOW", rdspCarryForwardYears: 9 }), 0);
    expect(plan.grantAtOptimalMinor).toBe(1_050_000);
    // Greedy: $3,500 of 300% band contributions ($10,500 grant needs only part of the bands)
    expect(plan.optimalContributionMinor).toBe(350_000);
  });

  it("credits contributions already made this year", () => {
    const profile = makeProfile({ rdspIncomeTier: "LOW" });
    const plan = cdsgPlan(profile, 150_000); // already contributed the optimal amount
    expect(plan.additionalGrantMinor).toBe(0);
  });

  it("respects lifetime grant room", () => {
    const profile = makeProfile({ rdspIncomeTier: "LOW", rdspGrantsLifetimeMinor: 6_900_000 });
    const plan = cdsgPlan(profile, 0); // only $1,000 of grant room left
    // $1,000.00 room at a 300% match needs a $333.33⅓ contribution — impossible in integer
    // cents, so the engine rounds the contribution down and the max reachable grant is $999.99.
    expect(plan.optimalContributionMinor).toBe(33_333);
    expect(plan.grantAtOptimalMinor).toBe(99_999);
  });

  it("treats UNKNOWN tier as HIGH (conservative)", () => {
    const plan = cdsgPlan(makeProfile({ rdspIncomeTier: "UNKNOWN" }), 0);
    expect(plan.grantAtOptimalMinor).toBe(100_000); // 100% on $1,000
  });
});

describe("cdsgRule", () => {
  it("emits a warning-level opportunity naming the exact contribution", () => {
    const profile = makeProfile({ rdspIncomeTier: "LOW", rdspCarryForwardYears: 1 });
    const rdsp = makeAccount({ type: "RDSP" });
    const alerts = cdsgRule.evaluate(profile, makeSnapshot([rdsp]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("opportunity");
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].message).toContain("$3,000.00");
    expect(alerts[0].message).toContain("$7,000.00");
    expect(alerts[0].valueMinor).toBe(700_000);
  });

  it("suggests opening an RDSP when DTC-eligible but no account exists", () => {
    const profile = makeProfile({ dtcEligible: true });
    const alerts = cdsgRule.evaluate(profile, makeSnapshot([]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toMatch(/open an RDSP/i);
  });

  it("is silent with no RDSP and no DTC eligibility", () => {
    expect(cdsgRule.evaluate(makeProfile(), makeSnapshot([]))).toHaveLength(0);
  });
});

describe("cdsbRule", () => {
  it("reminds LOW-tier holders the bond needs no contribution", () => {
    const profile = makeProfile({ rdspIncomeTier: "LOW" });
    const rdsp = makeAccount({ type: "RDSP" });
    const alerts = cdsbRule.evaluate(profile, makeSnapshot([rdsp]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].valueMinor).toBe(100_000);
  });

  it("is silent for HIGH tier", () => {
    const rdsp = makeAccount({ type: "RDSP" });
    expect(cdsbRule.evaluate(makeProfile({ rdspIncomeTier: "HIGH" }), makeSnapshot([rdsp]))).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test` — expect FAIL.

- [x] **Step 3: Implement**

Create `src/engine/rules/rdsp.ts`:

```ts
import { formatMinorUnits } from "../money";
import { THRESHOLDS } from "./thresholds";
import type { ProfileView, Rule } from "./types";
import { txsThisYear } from "./types";

export interface CdsgPlanResult {
  optimalContributionMinor: number;
  grantAtOptimalMinor: number;
  additionalGrantMinor: number;
  effectiveMatchPct: number;
}

export function cdsgPlan(profile: ProfileView, contributedThisYearMinor: number): CdsgPlanResult {
  const bands =
    profile.rdspIncomeTier === "LOW" ? THRESHOLDS.CDSG.LOW_BANDS : THRESHOLDS.CDSG.HIGH_BANDS;
  const years = 1 + Math.max(0, profile.rdspCarryForwardYears);

  const grantRoom = Math.min(
    THRESHOLDS.CDSG.ANNUAL_MAX_WITH_CARRYFORWARD,
    Math.max(0, THRESHOLDS.CDSG.LIFETIME_GRANT_MAX - profile.rdspGrantsLifetimeMinor),
  );
  const contribRoom = Math.max(
    0,
    THRESHOLDS.CDSG.LIFETIME_CONTRIB_MAX - profile.rdspContribLifetimeMinor - contributedThisYearMinor,
  );

  // Walk bands highest-rate-first (they are declared in that order), greedily buying grant.
  let grant = 0;
  let contribution = 0;
  for (const band of bands) {
    const bandCap = band.contributionCap * years;
    if (grant >= grantRoom || contribution >= contribRoom) break;
    const grantLeft = grantRoom - grant;
    const contribLeft = contribRoom - contribution;
    const take = Math.min(bandCap, contribLeft, Math.floor(grantLeft / band.matchRate));
    contribution += take;
    grant += take * band.matchRate;
  }

  const grantOnCurrent = (() => {
    let g = 0;
    let c = contributedThisYearMinor;
    for (const band of bands) {
      const bandCap = band.contributionCap * years;
      const used = Math.min(bandCap, c);
      g += used * band.matchRate;
      c -= used;
      if (c <= 0) break;
    }
    return Math.min(g, grantRoom);
  })();

  return {
    optimalContributionMinor: contribution,
    grantAtOptimalMinor: grant,
    additionalGrantMinor: Math.max(0, grant - grantOnCurrent),
    effectiveMatchPct: contribution > 0 ? Math.round((grant / contribution) * 100) : 0,
  };
}

export const cdsgRule: Rule = {
  key: "RDSP_CDSG",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "Canada Disability Savings Act; ESDC CDSG matching tiers",
  lastReviewed: "2026-08-14",
  evaluate(profile, snapshot) {
    const rdspAccounts = snapshot.accounts.filter((a) => a.type === "RDSP");
    if (rdspAccounts.length === 0) {
      if (!profile.dtcEligible) return [];
      return [
        {
          ruleKey: "RDSP_CDSG",
          severity: "warning",
          kind: "opportunity",
          entityRef: "",
          title: "DTC-eligible with no RDSP on file",
          message: "You are marked DTC-eligible but no RDSP account exists here. The CDSG matches contributions at up to 300% — the highest-ROI dollar available anywhere.",
          action: "Open an RDSP (or add your existing one under Investments), then this optimizer computes your exact contribution.",
          citation: "Canada Disability Savings Act",
        },
      ];
    }

    const contributed = rdspAccounts
      .flatMap((a) => txsThisYear(a, snapshot.today, "CONTRIBUTION"))
      .reduce((sum, t) => sum + t.amountMinor, 0);
    const plan = cdsgPlan(profile, contributed);
    if (plan.additionalGrantMinor <= 0) return [];

    const tierNote =
      profile.rdspIncomeTier === "UNKNOWN"
        ? " (income tier UNKNOWN — treated as the lower 100% match; set your tier in Settings, the real number may be much higher)"
        : "";
    const remainingContribution = plan.optimalContributionMinor - contributed;

    return [
      {
        ruleKey: "RDSP_CDSG",
        severity: "warning",
        kind: "opportunity",
        entityRef: "",
        title: `CDSG: ${formatMinorUnits(plan.additionalGrantMinor, "CAD")} in grants available this year`,
        message: `Contribute ${formatMinorUnits(Math.max(0, remainingContribution), "CAD")} more by Dec 31 to receive ${formatMinorUnits(plan.grantAtOptimalMinor, "CAD")} in CDSG — an effective ${plan.effectiveMatchPct}% match${tierNote}. ${THRESHOLDS.CDSG.INCOME_THRESHOLD_NOTE}.`,
        action: "This is the app's highest-ROI dollar: fund the RDSP before any other account. Verify your carry-forward entitlement on your ESDC Statement of Grant Entitlement.",
        citation: "Canada Disability Savings Act; ESDC",
        valueMinor: plan.additionalGrantMinor,
        valueCurrency: "CAD",
      },
    ];
  },
};

export const cdsbRule: Rule = {
  key: "RDSP_CDSB",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "Canada Disability Savings Act — CDSB pays without contributions, income-tested",
  lastReviewed: "2026-08-14",
  evaluate(profile, snapshot) {
    if (profile.rdspIncomeTier !== "LOW") return [];
    if (!snapshot.accounts.some((a) => a.type === "RDSP")) return [];
    return [
      {
        ruleKey: "RDSP_CDSB",
        severity: "info",
        kind: "opportunity",
        entityRef: "",
        title: `CDSB: up to ${formatMinorUnits(THRESHOLDS.CDSB.ANNUAL_MAX, "CAD")}/yr with zero contribution`,
        message: `At the low income tier the Canada Disability Savings Bond pays up to ${formatMinorUnits(THRESHOLDS.CDSB.ANNUAL_MAX, "CAD")}/yr into the RDSP without any contribution (lifetime cap ${formatMinorUnits(THRESHOLDS.CDSB.LIFETIME_MAX, "CAD")}; up to 10 years of carry-forward).`,
        action: "Nothing to deposit — just ensure the RDSP is open and your tax returns are filed (income testing uses them). Verify bond entitlement on your ESDC statement.",
        citation: "Canada Disability Savings Act",
        valueMinor: THRESHOLDS.CDSB.ANNUAL_MAX,
        valueCurrency: "CAD",
      },
    ];
  },
};
```

- [x] **Step 4: Run tests, commit**

Run: `npm test` — expect pass. Hand-check the acceptance case: bands ×2 = $1,000@300% + $2,000@200% → contribution $3,000, grant $3,000+$4,000 = $7,000, match 233%. Matches the spec's acceptance criterion.

```bash
git add src/engine/rules/rdsp.*
git commit -m "feat: add RDSP CDSG optimizer and CDSB bond rules"
```

---

### Task 9: Canadian credits, income-support thresholds, NHT — and the rule index

**Files:**
- Create: `src/engine/rules/ca-benefits.ts`, `src/engine/rules/ca-benefits.test.ts`, `src/engine/rules/index.ts`

**Interfaces:**
- Consumes: types, fixtures, `THRESHOLDS`, `convertMinor`, `formatMinorUnits`, `annualizeMinor`, `monthlyMinor`.
- Produces: `dtcRule`, `cwbRule`, `employmentAmountRule`, `incomeSupportRule`, `nhtRule`; and `ALL_RULES: Rule[]` in `index.ts` registering every rule from Tasks 5–9 — 19 rule objects implementing the spec's 17 non-deferred launch items (FBAR/8938 are separate objects; the spec's single room-guard item is four objects; the spec's two TFSA items are two objects).

- [x] **Step 1: Write the failing test**

Create `src/engine/rules/ca-benefits.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeAccount, makeProfile, makeSnapshot } from "./fixtures";
import { cwbRule, dtcRule, employmentAmountRule, incomeSupportRule, nhtRule } from "./ca-benefits";
import { ALL_RULES } from "./index";

const employment = { name: "Job", amountMinor: 200_000, cadence: "MONTHLY" as const, kind: "EMPLOYMENT" as const };

describe("dtcRule", () => {
  it("reminds DTC-eligible users of the credit value", () => {
    const alerts = dtcRule.evaluate(makeProfile({ dtcEligible: true }), makeSnapshot([]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].valueMinor).toBe(148_080); // 9,872.00 × 15%
  });

  it("is silent otherwise", () => {
    expect(dtcRule.evaluate(makeProfile(), makeSnapshot([]))).toHaveLength(0);
  });
});

describe("cwbRule", () => {
  it("flags likely eligibility for working income under the cutoff", () => {
    const profile = makeProfile({ incomeSources: [employment] }); // $24,000/yr
    const alerts = cwbRule.evaluate(profile, makeSnapshot([]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain("up to");
  });

  it("is silent above the net-income cutoff", () => {
    const rich = makeProfile({
      incomeSources: [{ ...employment, amountMinor: 400_000 }], // $48,000/yr
    });
    expect(cwbRule.evaluate(rich, makeSnapshot([]))).toHaveLength(0);
  });
});

describe("employmentAmountRule", () => {
  it("reminds about the CEA when employment income exists", () => {
    const alerts = employmentAmountRule.evaluate(makeProfile({ incomeSources: [employment] }), makeSnapshot([]));
    expect(alerts).toHaveLength(1);
  });
});

describe("incomeSupportRule (OW)", () => {
  const owProfile = makeProfile({ benefitPrograms: ["OW"], incomeSources: [employment] }); // $2,000/mo earned

  it("computes the monthly clawback above the $200 exemption", () => {
    const alerts = incomeSupportRule.evaluate(owProfile, makeSnapshot([]));
    const earnings = alerts.find((a) => a.entityRef === "earnings");
    expect(earnings).toBeDefined();
    expect(earnings!.message).toContain("$900.00"); // (2000-200) × 50%
  });

  it("warns when countable assets approach the $10k limit", () => {
    const cash = makeAccount({ type: "CASH", balanceMinor: 900_000 }); // $9,000
    const rdsp = makeAccount({ type: "RDSP", balanceMinor: 5_000_000 }); // exempt
    const alerts = incomeSupportRule.evaluate(owProfile, makeSnapshot([cash, rdsp]));
    const assets = alerts.find((a) => a.entityRef === "assets");
    expect(assets).toBeDefined();
    expect(assets!.severity).toBe("warning");
    expect(assets!.message).toContain("$9,000.00");
    expect(assets!.message).not.toContain("$59,000.00"); // RDSP must be excluded
  });

  it("goes critical at or over the asset limit", () => {
    const cash = makeAccount({ type: "CASH", balanceMinor: 1_100_000 });
    const alerts = incomeSupportRule.evaluate(owProfile, makeSnapshot([cash]));
    expect(alerts.find((a) => a.entityRef === "assets")!.severity).toBe("critical");
  });

  it("is silent without an enrolled program", () => {
    expect(incomeSupportRule.evaluate(makeProfile(), makeSnapshot([]))).toHaveLength(0);
  });
});

describe("nhtRule", () => {
  it("reminds JM citizens who contributed", () => {
    const profile = makeProfile({ citizenships: ["US", "CA", "JM"], nhtContributed: true });
    expect(nhtRule.evaluate(profile, makeSnapshot([]))).toHaveLength(1);
  });

  it("is silent without contributions", () => {
    const profile = makeProfile({ citizenships: ["JM"] });
    expect(nhtRule.evaluate(profile, makeSnapshot([]))).toHaveLength(0);
  });
});

describe("ALL_RULES", () => {
  it("registers all 19 Phase-2 rule objects with unique keys", () => {
    const keys = ALL_RULES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining([
        "FBAR", "FORM_8938", "PFIC", "ROTH_FREEZE", "TFSA_US_DRAG", "TFSA_US_WITHHOLDING",
        "T1135", "TFSA_ROOM", "RRSP_ROOM", "FHSA_ROOM", "RDSP_LIFETIME", "STALE_DATA",
        "RDSP_CDSG", "RDSP_CDSB", "DTC", "CWB", "CANADA_EMPLOYMENT_AMOUNT", "INCOME_SUPPORT", "NHT",
      ]),
    );
  });
});
```

(The assertion lists all 19 rule keys and checks uniqueness — it is the source of truth for the registry's contents.)

- [x] **Step 2: Run test to verify it fails**

Run: `npm test` — expect FAIL.

- [x] **Step 3: Implement**

Create `src/engine/rules/ca-benefits.ts`:

```ts
import { convertMinor } from "../fx";
import { formatMinorUnits } from "../money";
import { THRESHOLDS } from "./thresholds";
import type { Rule, RuleAlert } from "./types";
import { annualizeMinor, monthlyMinor } from "./types";

export const dtcRule: Rule = {
  key: "DTC",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "ITA line 31600 — disability amount (federal; provincial amount additional)",
  lastReviewed: "2026-08-14",
  evaluate(profile) {
    if (!profile.dtcEligible) return [];
    const value = Math.round((THRESHOLDS.DTC_FEDERAL_AMOUNT * THRESHOLDS.FEDERAL_CREDIT_RATE_PCT) / 100);
    return [
      {
        ruleKey: "DTC",
        severity: "info",
        kind: "opportunity",
        entityRef: "",
        title: `Disability Tax Credit: ≈ ${formatMinorUnits(value, "CAD")} federal at tax time`,
        message: `The federal disability amount (~${formatMinorUnits(THRESHOLDS.DTC_FEDERAL_AMOUNT, "CAD")}, indexed annually) yields ≈ ${formatMinorUnits(value, "CAD")} at the ${THRESHOLDS.FEDERAL_CREDIT_RATE_PCT}% federal rate, plus the provincial amount. DTC eligibility is also what unlocks the RDSP.`,
        action: "Claim line 31600 on the T1. If a supporting family member has higher income, the credit can transfer — ask at tax time.",
        citation: "ITA line 31600",
        valueMinor: value,
        valueCurrency: "CAD",
      },
    ];
  },
};

export const cwbRule: Rule = {
  key: "CWB",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "ITA s.122.7 — Canada Workers Benefit (figures indexed annually; VERIFY at tax time)",
  lastReviewed: "2026-08-14",
  evaluate(profile) {
    const working = profile.incomeSources
      .filter((s) => s.kind === "EMPLOYMENT" || s.kind === "SELF_EMPLOYMENT")
      .reduce((sum, s) => sum + annualizeMinor(s), 0);
    const net = profile.incomeSources.reduce((sum, s) => sum + annualizeMinor(s), 0);
    if (working < THRESHOLDS.CWB.MIN_WORKING_INCOME || net >= THRESHOLDS.CWB.NET_INCOME_CUTOFF_SINGLE) {
      return [];
    }
    return [
      {
        ruleKey: "CWB",
        severity: "info",
        kind: "opportunity",
        entityRef: "",
        title: `Canada Workers Benefit: likely eligible, up to ${formatMinorUnits(THRESHOLDS.CWB.MAX_SINGLE, "CAD")}`,
        message: `Working income ≈ ${formatMinorUnits(working, "CAD")}/yr with net income under the ≈ ${formatMinorUnits(THRESHOLDS.CWB.NET_INCOME_CUTOFF_SINGLE, "CAD")} single cutoff suggests CWB eligibility of up to ${formatMinorUnits(THRESHOLDS.CWB.MAX_SINGLE, "CAD")} (phases out with income; disability supplement may add more).`,
        action: "The CWB is claimed on Schedule 6 of the T1 — most tax software applies it automatically; just make sure you file.",
        citation: "ITA s.122.7",
        valueMinor: THRESHOLDS.CWB.MAX_SINGLE,
        valueCurrency: "CAD",
      },
    ];
  },
};

export const employmentAmountRule: Rule = {
  key: "CANADA_EMPLOYMENT_AMOUNT",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "ITA line 31260 — Canada Employment Amount (indexed annually)",
  lastReviewed: "2026-08-14",
  evaluate(profile) {
    const hasEmployment = profile.incomeSources.some((s) => s.kind === "EMPLOYMENT");
    if (!hasEmployment) return [];
    const value = Math.round(
      (THRESHOLDS.CANADA_EMPLOYMENT_AMOUNT * THRESHOLDS.FEDERAL_CREDIT_RATE_PCT) / 100,
    );
    return [
      {
        ruleKey: "CANADA_EMPLOYMENT_AMOUNT",
        severity: "info",
        kind: "opportunity",
        entityRef: "",
        title: `Canada Employment Amount: ≈ ${formatMinorUnits(value, "CAD")} at tax time`,
        message: `Employment income allows claiming up to ${formatMinorUnits(THRESHOLDS.CANADA_EMPLOYMENT_AMOUNT, "CAD")} (line 31260) — worth ≈ ${formatMinorUnits(value, "CAD")} federally. Not available for self-employment income.`,
        action: "Claimed automatically by most tax software; verify it appears on the return.",
        citation: "ITA line 31260",
        valueMinor: value,
        valueCurrency: "CAD",
      },
    ];
  },
};

const OW_COUNTABLE_TYPES = new Set(["CASH", "CHEQUING", "TFSA", "NON_REGISTERED", "CRYPTO", "RRSP"]);
const ODSP_COUNTABLE_TYPES = new Set(["CASH", "CHEQUING", "TFSA", "NON_REGISTERED", "CRYPTO", "RRSP"]);

export const incomeSupportRule: Rule = {
  key: "INCOME_SUPPORT",
  jurisdiction: "CA",
  kind: "compliance",
  citation: "Ontario Works Act / ODSP Act regulations — earnings exemptions and asset limits (change frequently; VERIFY with caseworker)",
  lastReviewed: "2026-08-14",
  evaluate(profile, snapshot) {
    const program = profile.benefitPrograms.find((p) => p === "OW" || p === "ODSP");
    if (!program) return [];
    const params = THRESHOLDS.ONTARIO_SUPPORT[program as "OW" | "ODSP"];
    const countableTypes = program === "OW" ? OW_COUNTABLE_TYPES : ODSP_COUNTABLE_TYPES;
    const alerts: RuleAlert[] = [];

    const monthlyEarned = profile.incomeSources
      .filter((s) => s.kind === "EMPLOYMENT" || s.kind === "SELF_EMPLOYMENT")
      .reduce((sum, s) => sum + monthlyMinor(s), 0);
    if (monthlyEarned > 0) {
      const clawback = Math.max(
        0,
        Math.round(((monthlyEarned - params.MONTHLY_EARNINGS_EXEMPT) * params.CLAWBACK_PCT) / 100),
      );
      alerts.push({
        ruleKey: "INCOME_SUPPORT",
        severity: "info",
        kind: "compliance",
        entityRef: "earnings",
        title: `${program} earnings: ≈ ${formatMinorUnits(clawback, "CAD")}/mo clawback at current income`,
        message: `Earned income ≈ ${formatMinorUnits(monthlyEarned, "CAD")}/mo. ${program} exempts the first ${formatMinorUnits(params.MONTHLY_EARNINGS_EXEMPT, "CAD")}/mo, then reduces benefits by ${params.CLAWBACK_PCT}% of the rest — ≈ ${formatMinorUnits(clawback, "CAD")}/mo here.`,
        action: "Report earnings accurately and verify current exemption rules with your caseworker — figures change and individual circumstances vary.",
        citation: "Ontario Works / ODSP regulations",
        valueMinor: clawback,
        valueCurrency: "CAD",
      });
    }

    const countable = snapshot.accounts
      .filter((a) => countableTypes.has(a.type))
      .reduce((sum, a) => sum + convertMinor(a.balanceMinor, a.currency, "CAD", snapshot.fxRates), 0);
    const limit = params.ASSET_LIMIT_SINGLE;
    if (countable >= limit * 0.8) {
      alerts.push({
        ruleKey: "INCOME_SUPPORT",
        severity: countable >= limit ? "critical" : "warning",
        kind: "compliance",
        entityRef: "assets",
        title:
          countable >= limit
            ? `${program} asset limit exceeded`
            : `${program} assets at ${Math.round((countable / limit) * 100)}% of the limit`,
        message: `Countable assets ≈ ${formatMinorUnits(countable, "CAD")} vs the ${formatMinorUnits(limit, "CAD")} single-person limit (RDSP and principal residence are exempt and excluded here).`,
        action: "Verify countable-asset treatment with your caseworker. Note: RDSP contributions are exempt — moving eligible savings there can both earn CDSG and reduce countable assets. Verify before acting.",
        citation: "Ontario Works / ODSP regulations",
        valueMinor: countable,
        valueCurrency: "CAD",
      });
    }
    return alerts;
  },
};

export const nhtRule: Rule = {
  key: "NHT",
  jurisdiction: "JM",
  kind: "opportunity",
  citation: "Jamaica National Housing Trust — contributions refundable in the 8th year (nht.gov.jm)",
  lastReviewed: "2026-08-14",
  evaluate(profile) {
    if (!profile.citizenships.includes("JM") || !profile.nhtContributed) return [];
    return [
      {
        ruleKey: "NHT",
        severity: "info",
        kind: "opportunity",
        entityRef: "",
        title: "NHT contribution refund may be claimable",
        message: `NHT contributions become refundable in the 8th year after they were made (${THRESHOLDS.NHT_REFUND_WAIT_YEARS}-year wait). Refunds are not automatic — they must be claimed, and unclaimed refunds accumulate.`,
        action: "Check your contribution years and claim eligible refunds on the NHT online portal (nht.gov.jm).",
        citation: "nht.gov.jm",
      },
    ];
  },
};
```

Create `src/engine/rules/index.ts`:

```ts
import type { Rule } from "./types";
import { fbarRule, form8938Rule } from "./us-reporting";
import { pficRule, rothFreezeRule, t1135Rule, tfsaDragRule, tfsaWithholdingRule } from "./cross-border";
import { fhsaRoomRule, rdspLifetimeRule, rrspRoomRule, staleDataRule, tfsaRoomRule } from "./rooms";
import { cdsbRule, cdsgRule } from "./rdsp";
import { cwbRule, dtcRule, employmentAmountRule, incomeSupportRule, nhtRule } from "./ca-benefits";

export const ALL_RULES: Rule[] = [
  fbarRule,
  form8938Rule,
  pficRule,
  rothFreezeRule,
  tfsaDragRule,
  tfsaWithholdingRule,
  t1135Rule,
  tfsaRoomRule,
  rrspRoomRule,
  fhsaRoomRule,
  rdspLifetimeRule,
  staleDataRule,
  cdsgRule,
  cdsbRule,
  dtcRule,
  cwbRule,
  employmentAmountRule,
  incomeSupportRule,
  nhtRule,
];

export { evaluateRules, applyDismissals } from "./registry";
```

- [x] **Step 4: Run tests, commit**

Run: `npm test` — expect pass (all engine suites).

```bash
git add src/engine/rules/
git commit -m "feat: add Canadian credits, income-support, NHT rules and rule index"
```

---

### Task 10: Money Finder UI, dismissals, dashboard panel, Roth action guard

**Files:**
- Create: `src/app/money-finder/actions.ts`, `src/components/alert-card.tsx`
- Modify: `src/app/money-finder/page.tsx`, `src/app/page.tsx` (alerts panel), `src/app/investments/actions.ts` + `src/app/investments/[id]/page.tsx` (Roth guard)

**Interfaces:**
- Consumes: `ALL_RULES`, `evaluateRules`, `applyDismissals`, `buildSnapshot`, `getOrCreateProfile`.
- Produces: `/money-finder` (active alerts grouped Compliance/Opportunities, dismiss buttons, `?dismissed=1` view with restore); dashboard panel showing the top 3 active alerts; `addTransaction` requiring `confirmRoth=true` for Roth contributions and logging overrides as `ROTH_OVERRIDE_LOG` Alert rows.

- [x] **Step 1: Dismissal actions**

Create `src/app/money-finder/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export async function dismissAlert(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const ruleKey = String(formData.get("ruleKey") ?? "");
  const entityRef = String(formData.get("entityRef") ?? "");
  if (!ruleKey) return;
  await prisma.alert.upsert({
    where: { userId_ruleKey_entityRef: { userId, ruleKey, entityRef } },
    update: { dismissedAt: new Date() },
    create: { userId, ruleKey, entityRef },
  });
  revalidatePath("/money-finder");
  revalidatePath("/");
}

export async function restoreAlert(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const ruleKey = String(formData.get("ruleKey") ?? "");
  const entityRef = String(formData.get("entityRef") ?? "");
  await prisma.alert.deleteMany({ where: { userId, ruleKey, entityRef } });
  revalidatePath("/money-finder");
  revalidatePath("/");
}
```

- [x] **Step 2: Alert card component**

Create `src/components/alert-card.tsx`:

```tsx
import type { RuleAlert } from "@/engine/rules/types";
import { formatMinorUnits } from "@/engine/money";
import { dismissAlert, restoreAlert } from "@/app/money-finder/actions";

const SEVERITY_STYLES: Record<RuleAlert["severity"], string> = {
  critical: "border-red-600",
  warning: "border-amber-500",
  info: "border-border",
};

export function AlertCard({ alert, mode }: { alert: RuleAlert; mode: "active" | "dismissed" }) {
  return (
    <div data-testid="alert-card" className={`rounded border-l-4 p-4 ${SEVERITY_STYLES[alert.severity]}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{alert.title}</p>
        {alert.valueMinor !== undefined && alert.valueCurrency ? (
          <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
            {formatMinorUnits(alert.valueMinor, alert.valueCurrency)}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm">{alert.message}</p>
      <p className="mt-2 text-sm text-muted-foreground">→ {alert.action}</p>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{alert.citation}</span>
        <form action={mode === "active" ? dismissAlert : restoreAlert}>
          <input type="hidden" name="ruleKey" value={alert.ruleKey} />
          <input type="hidden" name="entityRef" value={alert.entityRef} />
          <button type="submit" className="underline">
            {mode === "active" ? "dismiss" : "restore"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [x] **Step 3: Money Finder page**

Replace `src/app/money-finder/page.tsx` entirely with:

```tsx
import Link from "next/link";
import { AlertCard } from "@/components/alert-card";
import { ALL_RULES, applyDismissals, evaluateRules } from "@/engine/rules";
import { getOrCreateProfile } from "@/lib/profile";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { buildSnapshot } from "@/lib/snapshot";

export default async function MoneyFinderPage({
  searchParams,
}: {
  searchParams: Promise<{ dismissed?: string }>;
}) {
  const userId = await requireUserId();
  const { dismissed: showDismissed } = await searchParams;
  const today = new Date().toISOString().slice(0, 10);

  const [profile, snapshot, dismissals] = await Promise.all([
    getOrCreateProfile(userId),
    buildSnapshot(userId, today),
    prisma.alert.findMany({ where: { userId }, select: { ruleKey: true, entityRef: true } }),
  ]);

  const { alerts, errors } = evaluateRules(profile, snapshot, ALL_RULES);
  const { active, dismissed } = applyDismissals(alerts, dismissals);
  const shown = showDismissed ? dismissed : active;
  const compliance = shown.filter((a) => a.kind === "compliance");
  const opportunities = shown.filter((a) => a.kind === "opportunity");
  const totalOpportunity = opportunities.reduce((sum, a) => sum + (a.valueMinor ?? 0), 0);

  return (
    <main className="space-y-8 py-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Money Finder</h1>
          <p className="text-sm text-muted-foreground">
            {showDismissed
              ? `${dismissed.length} dismissed alert(s)`
              : `${active.length} active — rules evaluate fresh on every load`}
          </p>
        </div>
        <Link href={showDismissed ? "/money-finder" : "/money-finder?dismissed=1"} className="text-sm underline">
          {showDismissed ? "Show active" : `Dismissed (${dismissed.length})`}
        </Link>
      </header>

      {errors.length > 0 ? (
        <div className="rounded border border-red-600 p-4 text-sm">
          <p className="font-medium">Rule errors (the rest still evaluated):</p>
          <ul className="mt-1 list-inside list-disc">
            {errors.map((e) => (
              <li key={e.ruleKey}>
                {e.ruleKey}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section>
        <h2 className="font-medium">Compliance ({compliance.length})</h2>
        <div className="mt-3 space-y-3">
          {compliance.map((a) => (
            <AlertCard key={`${a.ruleKey}:${a.entityRef}`} alert={a} mode={showDismissed ? "dismissed" : "active"} />
          ))}
          {compliance.length === 0 ? <p className="text-sm text-muted-foreground">Nothing here.</p> : null}
        </div>
      </section>

      <section>
        <h2 className="font-medium">Opportunities ({opportunities.length})</h2>
        <div className="mt-3 space-y-3">
          {opportunities.map((a) => (
            <AlertCard key={`${a.ruleKey}:${a.entityRef}`} alert={a} mode={showDismissed ? "dismissed" : "active"} />
          ))}
          {opportunities.length === 0 ? <p className="text-sm text-muted-foreground">Nothing here.</p> : null}
        </div>
      </section>

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        MoneyTalks surfaces published program rules against your own data, with citations. It is not
        financial, tax, or legal advice; verify with your accountant or caseworker before acting.
        Rules inputs come from <Link href="/settings" className="underline">Settings</Link>.
      </footer>
    </main>
  );
}
```

- [x] **Step 4: Dashboard panel**

In `src/app/page.tsx`, replace the "Alerts &amp; opportunities — Phase 2" placeholder `div` with a real panel. Add to the page's data loading (after the existing queries):

```tsx
  const [profile, dismissals] = await Promise.all([
    getOrCreateProfile(userId),
    prisma.alert.findMany({ where: { userId }, select: { ruleKey: true, entityRef: true } }),
  ]);
  const snapshotForRules = await buildSnapshot(userId, today);
  const { alerts } = evaluateRules(profile, snapshotForRules, ALL_RULES);
  const { active } = applyDismissals(alerts, dismissals);
  const topAlerts = active.slice(0, 3);
```

(with imports `ALL_RULES, applyDismissals, evaluateRules` from `@/engine/rules`, `getOrCreateProfile` from `@/lib/profile`, `buildSnapshot` from `@/lib/snapshot`; reuse the page's existing `today` string) and the panel JSX:

```tsx
        <div className="rounded border p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Alerts &amp; opportunities</p>
            <Link href="/money-finder" className="text-xs underline">
              all ({active.length})
            </Link>
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {topAlerts.map((a) => (
              <li key={`${a.ruleKey}:${a.entityRef}`} className="truncate">
                {a.severity === "critical" ? "🔴" : a.severity === "warning" ? "🟡" : "ℹ️"} {a.title}
              </li>
            ))}
            {topAlerts.length === 0 ? <li className="text-muted-foreground">All clear.</li> : null}
          </ul>
        </div>
```

- [x] **Step 5: Roth action guard**

In `src/app/investments/actions.ts`, inside `addTransaction` after the account-ownership check, add:

```ts
    const target = await prisma.financialAccount.findFirst({
      where: { id: accountId, userId },
      select: { type: true },
    });
    if (
      target?.type === "ROTH_IRA" &&
      parsed.data.type === "CONTRIBUTION" &&
      formData.get("confirmRoth") !== "true"
    ) {
      return {
        ok: false,
        error:
          "ROTH_CONFIRM_REQUIRED: contributions while Canadian-resident can permanently taint the treaty election. Tick the confirmation box to record it anyway.",
      };
    }
```

and after a confirmed Roth contribution is created, log the override:

```ts
    if (target?.type === "ROTH_IRA" && parsed.data.type === "CONTRIBUTION") {
      await prisma.alert.create({
        data: { userId, ruleKey: "ROTH_OVERRIDE_LOG", entityRef: created.id },
      });
    }
```

(change the `prisma.transaction.create` call to capture its result as `created`). In `src/app/investments/[id]/page.tsx`, inside the transaction form, add (only when `account.type === "ROTH_IRA"`):

```tsx
          {account.type === "ROTH_IRA" ? (
            <label className="col-span-2 flex items-center gap-2 text-xs text-red-600 sm:col-span-4">
              <input type="checkbox" name="confirmRoth" value="true" />
              I understand a contribution while Canadian-resident may permanently taint the Roth treaty election.
            </label>
          ) : null}
```

- [x] **Step 6: Verify + commit**

Run: `npm run dev` — with fictional data: Money Finder renders both sections; dismissing an alert removes it and it appears under Dismissed; restoring brings it back; the dashboard panel shows the top 3; logging a CONTRIBUTION on a fictional ROTH_IRA account without the checkbox is refused with the explanation, with the checkbox it succeeds. Then `npm test && npm run lint && npm run build`.

```bash
git add src/app/money-finder/ src/components/alert-card.tsx src/app/page.tsx src/app/investments/
git commit -m "feat: add Money Finder page, dismissals, dashboard alerts, Roth guard"
```

---

### Task 11: E2E acceptance + deploy

**OWNER CHECKPOINT** (Step 3 onward).

**Files:**
- Create: `e2e/money-finder.spec.ts`

- [x] **Step 1: Write the E2E spec**

Create `e2e/money-finder.spec.ts`:

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

test("rules engine end to end", async ({ browser, baseURL }) => {
  const context = await createAuthedContext(browser, baseURL!);
  const page = await context.newPage();

  // Seed accounts via the Phase 1 fixture (5 fictional accounts incl. RRSP with XEQT.TO and an RDSP)
  await page.goto("/investments/import");
  await page
    .locator('input[name="file"]')
    .setInputFiles(path.join(__dirname, "fixtures", "import-sample.json"));
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText(/Imported: 5 accounts/)).toBeVisible();

  // Configure the profile: LOW tier, 1 carry-forward year, JM citizen who contributed to NHT
  await page.goto("/settings");
  await page.locator('input[name="citizenships"]').fill("US, CA, JM");
  await page.locator('select[name="rdspIncomeTier"]').selectOption("LOW");
  await page.locator('input[name="rdspCarryForwardYears"]').fill("1");
  await page.locator('input[name="nhtContributed"]').check();
  await page.getByRole("button", { name: "Save profile" }).click();

  // Money Finder: no PFIC yet (XEQT.TO sits in the RRSP — exempt)
  await page.goto("/money-finder");
  await expect(page.getByText(/CDSG/)).toBeVisible();
  await expect(page.getByText("$7,000.00", { exact: false })).toBeVisible(); // acceptance case
  await expect(page.getByText(/FBAR/)).toBeVisible();
  await expect(page.getByText(/PFIC risk/)).not.toBeVisible();

  // Add a Canadian-listed fund to the TFSA → CRITICAL PFIC appears
  await page.goto("/investments");
  await page.getByText("Maple TFSA").click();
  await page.locator('input[name="symbol"]').fill("FAKE.TO");
  await page.locator('input[name="name"]').fill("Fictional Canadian ETF");
  await page.locator('input[name="domicileCountry"]').fill("CA");
  await page.locator('input[name="quantity"]').fill("10");
  await page.locator('input[name="lastPriceMinor"]').fill("1000");
  await page.locator('input[name="priceAsOf"]').fill("2026-08-01");
  await page.getByRole("button", { name: /Add \/ update holding/ }).click();

  await page.goto("/money-finder");
  await expect(page.getByText(/PFIC risk: FAKE.TO/)).toBeVisible();

  // Dismiss the NHT alert; it moves to the dismissed view and can be restored
  const nhtCard = page.getByTestId("alert-card").filter({ hasText: "NHT contribution refund" });
  await nhtCard.getByRole("button", { name: "dismiss" }).click();
  await expect(page.getByText("NHT contribution refund")).not.toBeVisible();
  await page.goto("/money-finder?dismissed=1");
  await expect(page.getByText("NHT contribution refund")).toBeVisible();

  await context.close();
});
```

- [x] **Step 2: Run the full suite**

Run: `npm test && npm run lint && npm run build && npm run e2e`
Expected: everything green. If the CDSG dollar assertion fails, recompute by hand from `thresholds.ts` (bands × years) before touching code — the fixture, thresholds, and engine must agree.

```bash
git add e2e/money-finder.spec.ts
git commit -m "test: add Money Finder E2E acceptance flow"
```

- [ ] **Step 3: OWNER CHECKPOINT — pre-push audit and push**

Audit `git diff origin/main..HEAD` for personal tokens (fixtures must contain only the fictional names). Ask the owner for permission, then `git push origin main` — Vercel deploys, `prisma migrate deploy` applies the Profile/Alert migration.

- [ ] **Step 4: OWNER CHECKPOINT — real profile setup**

On the production site, the owner fills Settings with real values from `docs/private/owner-context.md`'s checklist: RDSP tier + carry-forward + lifetime figures (from the ESDC statement), CRA room numbers, DTC status, benefit programs, income sources, citizenships, NHT flag. Then they review Money Finder together with the alerts it produces — expecting at minimum the FBAR meter, TFSA annotations, CDSG optimizer with real numbers, and any real PFIC hits.

- [ ] **Step 5: Mark Phase 2 done**

All checkboxes checked; spec Phase 2 row satisfied. Bill-dependent rules (digital news, student-loan interest, mortgage prepayment) are queued for Phase 3 per Global Constraints. Next: plan Phase 3 (Bills).

---

## Self-review notes

- **Spec coverage (§5 launch rule set):** rules 1–9 → Tasks 5–7 (FBAR always-visible meter ✔, 8938 by filing status ✔, PFIC with RRSP exemption + spec acceptance test ✔, Roth blocking flow ✔ (action guard + logged override + engine rule), TFSA never-tax-free language ✔ (drag alert asserts absence of "tax-free"), withholding ✔, T1135 ✔, room guards ✔, stale-data ✔). Rules 10–15, 17, 20 → Tasks 8–9 (CDSG acceptance case tested exactly ✔, CDSB ✔, FHSA ✔, DTC ✔, CWB ✔, CEA ✔, income-support incl. RDSP-exempt asset logic ✔, NHT ✔). Rules 16/18/19 explicitly deferred to Phase 3 (bill-dependent — documented in Global Constraints). Fresh-evaluation + dismissal-only persistence ✔ (registry + Alert model). Alerts carry severity/value/explanation/citation/next-step ✔. Rule errors surface visibly ✔.
- **Type consistency:** `RuleAlert.entityRef` is non-nullable string everywhere (matches `Alert.entityRef @default("")`); `ProfileView` field names match `Profile` columns and `getOrCreateProfile` mapping; `cdsgPlan` signature matches its uses; `ALL_RULES` includes exactly the 19 rule objects listed in its test.
- **Math hand-checks:** CDSG acceptance (×2 bands: $3,000 → $7,000, 233%) ✔; CDSG cap case (carry-forward 9 → grant capped $10,500, greedy contribution $3,500 at 300%) ✔; drag ($120,000 × 24% = $28,800) ✔; OW clawback (($2,000−$200)×50% = $900) ✔; DTC ($9,872 × 15% = $1,480.80) ✔; FBAR test (21,000 CAD @1.4 = 15,000 USD max; 7,000 CAD = 5,000 USD current) ✔.
- **Known risks stated in-plan:** threshold values need Task 2 Step 3 web-verification; CDSG carry-forward model is a documented simplification (per-year entitlement tracking is future work); OW/ODSP parameters change frequently (alerts say verify with caseworker; rule `lastReviewed` enforces annual re-checks via RULES_STALE).
