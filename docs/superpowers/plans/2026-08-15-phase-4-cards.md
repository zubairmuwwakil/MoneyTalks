# MoneyTalks Phase 4 (Cards) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Cards module — an instant "which card do I pull out?" picker (≤2 taps, context chips, merchant search), a printable wallet cheat sheet, annual-fee ROI meters with KEEP / DOWNGRADE / CANCEL-CANDIDATE verdicts, and a caps tracker — with every card fact living in the database, imported privately at runtime.

**Architecture:** The recommendation engine is **entirely data-driven**: it knows nothing about any real card. Each card row carries a validated `rewards` JSON (point value, FX fee, base and category multipliers with caps, credits); the engine computes `effectiveReturnPct = multiplier × pointValueCents − fxFee`, excludes cards the merchant can't accept, demotes capped categories, and explains itself in a one-line "why". Public retail facts (Costco is Mastercard-only in-store, some grocers decline Amex) ship in the repo as a merchant module; which cards exist in the wallet never does.

**Tech Stack:** No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-14-moneytalks-design.md`

**Prerequisite:** Phases 0–3 complete (engines, validation modules, import pipeline, rules registry at 22, E2E session helper with `workers: 1`).

## Global Constraints

All Phase 0–3 Global Constraints apply, with two amendments:

- **Commit authorship (supersedes earlier phases' trailer rule):** the owner is sole author. Do **NOT** add `Co-Authored-By` or any AI-attribution trailer to commits.
- **The fixture trap, learned the hard way in Phase 3:** earlier "fictional" fixtures turned out to be transcribed real numbers. Every fixture card in this plan uses **invented** rates, fees, caps, and names ("Fixture Alpha Amex" etc.) that deliberately do not reproduce any real card in the owner's wallet — and the implementer must keep it that way. If the owner supplies a real value mid-session (a rate, a fee, a date), it goes in `docs/private/` or the database, never into code, tests, fixtures, or this plan. Before the phase's first push, re-confirm with the owner that nothing real leaked in.
- Real wallet data path: the owner's `~/Downloads/files2/cards.json` (10 real cards) is converted privately into `docs/private/cards-import.json` (import format below) at the final checkpoint, verified against issuer websites at that time, and imported on production. The repo never contains it, nor any real issuer+product combination from the wallet.
- Merchant facts that are public retail knowledge (network acceptance at major Canadian chains) are allowed in the repo, each with a "verify locally, acceptance changes" hedge in the UI.

---

### Task 1: Schema — CreditCard + CardState

**Files:**
- Modify: `prisma/schema.prisma` (add models; add `creditCards CreditCard[]` relation to `User`)

**Interfaces:**
- Produces: `CreditCard` (facts, `rewards` JSON) and `CardState` (1:1 — caps usage, credits redeemed, rewards estimate).

- [ ] **Step 1: Extend the schema**

Append to `prisma/schema.prisma`:

```prisma
// ---- Cards (Phase 4) ----

model CreditCard {
  id             String     @id @default(cuid())
  userId         String
  user           User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  nickname       String
  issuer         String
  network        String // VISA | MASTERCARD | AMEX
  lastFour       String?
  country        String     @default("CA")
  currency       String     @default("CAD")
  limitMinor     Int?
  statementDay   Int?
  dueDay         Int?
  aprPct         Decimal?
  annualFeeMinor Int        @default(0)
  rewards        Json // validated rewards structure — see src/lib/validation/cards.ts
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
  state          CardState?

  @@unique([userId, nickname])
}

model CardState {
  cardId               String     @id
  card                 CreditCard @relation(fields: [cardId], references: [id], onDelete: Cascade)
  capsUsage            Json       @default("[]") // [{category, periodKey, usedMinor}]
  creditsRedeemed      Json       @default("[]") // [{creditId, periodKey}]
  rewardsEstimateMinor Int        @default(0) // owner's estimate of rewards earned this year
  updatedAt            DateTime   @updatedAt
}
```

- [ ] **Step 2: Migrate, verify, commit**

```bash
npx dotenv -e .env.local -- npx prisma migrate dev --name credit-cards
npx dotenv -e .env.local -- npx prisma migrate status
npm run build
git add prisma/
git commit -m "feat: add CreditCard and CardState models"
```

---

### Task 2: Card types, rewards validation, invented fixtures

**Files:**
- Create: `src/engine/cards/types.ts`, `src/engine/cards/fixtures.ts`, `src/lib/validation/cards.ts`, `src/lib/validation/cards.test.ts`

**Interfaces:**
- Produces:
  - `type Network = "VISA" | "MASTERCARD" | "AMEX"`
  - `type SpendCategory = "groceries" | "dining" | "gas" | "bills" | "streaming" | "travel" | "warehouse" | "home_improvement" | "hotel" | "online_foreign" | "everything_else"` (+ `SPEND_CATEGORIES` array + `CATEGORY_LABELS` record)
  - `interface CardCredit { id: string; label: string; valueMinor: number; period: "YEAR" | "MONTH" }`
  - `interface CategoryRate { category: SpendCategory; multiplier: number; capMinor?: number; capWindow?: "MONTH" | "YEAR" }`
  - `interface CardRewards { pointValueCents: number; fxFeePct: number; baseMultiplier: number; categoryRates: CategoryRate[]; credits: CardCredit[] }`
  - `interface CardDef { id: string; nickname: string; network: Network; annualFeeMinor: number; rewards: CardRewards }`
  - `interface CapUsage { cardId: string; category: SpendCategory; periodKey: string; usedMinor: number }`
  - Zod `cardRewardsInput`, `cardImportEntry`; fixtures `FIXTURE_CARDS: CardDef[]` (three invented cards used by every test).

- [ ] **Step 1: Types**

Create `src/engine/cards/types.ts`:

```ts
export type Network = "VISA" | "MASTERCARD" | "AMEX";

export const SPEND_CATEGORIES = [
  "groceries",
  "dining",
  "gas",
  "bills",
  "streaming",
  "travel",
  "warehouse",
  "home_improvement",
  "hotel",
  "online_foreign",
  "everything_else",
] as const;

export type SpendCategory = (typeof SPEND_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<SpendCategory, string> = {
  groceries: "Groceries",
  dining: "Dining & delivery",
  gas: "Gas",
  bills: "Bills & utilities",
  streaming: "Streaming",
  travel: "Travel booking",
  warehouse: "Warehouse club",
  home_improvement: "Home improvement",
  hotel: "Hotel",
  online_foreign: "Online (foreign currency)",
  everything_else: "Everything else",
};

export interface CardCredit {
  id: string;
  label: string;
  valueMinor: number;
  period: "YEAR" | "MONTH";
}

export interface CategoryRate {
  category: SpendCategory;
  multiplier: number;
  capMinor?: number;
  capWindow?: "MONTH" | "YEAR";
}

export interface CardRewards {
  pointValueCents: number; // cents of value per point; 1 = plain cashback
  fxFeePct: number;
  baseMultiplier: number;
  categoryRates: CategoryRate[];
  credits: CardCredit[];
}

export interface CardDef {
  id: string;
  nickname: string;
  network: Network;
  annualFeeMinor: number;
  rewards: CardRewards;
}

export interface CapUsage {
  cardId: string;
  category: SpendCategory;
  periodKey: string; // "2026-08" for MONTH windows, "2026" for YEAR windows
  usedMinor: number;
}

export function periodKeyFor(window: "MONTH" | "YEAR", today: string): string {
  return window === "MONTH" ? today.slice(0, 7) : today.slice(0, 4);
}
```

- [ ] **Step 2: Invented fixtures**

Create `src/engine/cards/fixtures.ts` — **invented numbers; resemblance to any real card is coincidental and must be avoided**:

```ts
import type { CardDef } from "./types";

export const FIXTURE_CARDS: CardDef[] = [
  {
    id: "alpha",
    nickname: "Fixture Alpha Amex",
    network: "AMEX",
    annualFeeMinor: 15_000, // $150 invented
    rewards: {
      pointValueCents: 1.2,
      fxFeePct: 2.5,
      baseMultiplier: 1,
      categoryRates: [
        { category: "dining", multiplier: 5 },
        { category: "groceries", multiplier: 4, capMinor: 150_000, capWindow: "MONTH" },
      ],
      credits: [{ id: "dine100", label: "$100 dining credit", valueMinor: 10_000, period: "YEAR" }],
    },
  },
  {
    id: "beta",
    nickname: "Fixture Beta Visa",
    network: "VISA",
    annualFeeMinor: 0,
    rewards: {
      pointValueCents: 1,
      fxFeePct: 2.5,
      baseMultiplier: 1.5,
      categoryRates: [{ category: "groceries", multiplier: 3 }],
      credits: [],
    },
  },
  {
    id: "gamma",
    nickname: "Fixture Gamma MC",
    network: "MASTERCARD",
    annualFeeMinor: 12_000,
    rewards: {
      pointValueCents: 1,
      fxFeePct: 0,
      baseMultiplier: 2,
      categoryRates: [],
      credits: [{ id: "travel90", label: "$90 travel credit", valueMinor: 9_000, period: "YEAR" }],
    },
  },
];
```

- [ ] **Step 3: Failing validation test**

Create `src/lib/validation/cards.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FIXTURE_CARDS } from "@/engine/cards/fixtures";
import { cardImportEntry, cardRewardsInput } from "./cards";

describe("cardRewardsInput", () => {
  it("accepts every fixture card's rewards", () => {
    for (const card of FIXTURE_CARDS) {
      expect(cardRewardsInput.safeParse(card.rewards).success).toBe(true);
    }
  });

  it("rejects unknown categories, negative values, and caps without windows", () => {
    const base = FIXTURE_CARDS[0].rewards;
    expect(
      cardRewardsInput.safeParse({
        ...base,
        categoryRates: [{ category: "lottery", multiplier: 2 }],
      }).success,
    ).toBe(false);
    expect(cardRewardsInput.safeParse({ ...base, pointValueCents: -1 }).success).toBe(false);
    expect(
      cardRewardsInput.safeParse({
        ...base,
        categoryRates: [{ category: "dining", multiplier: 2, capMinor: 1000 }],
      }).success,
    ).toBe(false);
  });
});

describe("cardImportEntry", () => {
  it("accepts a full card entry", () => {
    expect(
      cardImportEntry.safeParse({
        nickname: "Fixture Alpha Amex",
        issuer: "Fixture Financial",
        network: "AMEX",
        annualFeeMinor: 15000,
        dueDay: 15,
        rewards: FIXTURE_CARDS[0].rewards,
      }).success,
    ).toBe(true);
  });

  it("rejects a bad network and out-of-range due days", () => {
    const good = {
      nickname: "x",
      issuer: "y",
      network: "AMEX",
      rewards: FIXTURE_CARDS[0].rewards,
    };
    expect(cardImportEntry.safeParse({ ...good, network: "DINERS" }).success).toBe(false);
    expect(cardImportEntry.safeParse({ ...good, dueDay: 31 }).success).toBe(false);
  });
});
```

- [ ] **Step 4: Run to verify failure, implement the schema**

Run: `npm test` — FAIL. Create `src/lib/validation/cards.ts`:

```ts
import { z } from "zod";
import { SPEND_CATEGORIES } from "@/engine/cards/types";
import { currencyCode } from "./investments";

const minor = z.coerce.number().int().safe().nonnegative();

export const cardRewardsInput = z.object({
  pointValueCents: z.number().positive().max(10),
  fxFeePct: z.number().min(0).max(5),
  baseMultiplier: z.number().min(0).max(10),
  categoryRates: z.array(
    z
      .object({
        category: z.enum(SPEND_CATEGORIES),
        multiplier: z.number().positive().max(20),
        capMinor: minor.positive().optional(),
        capWindow: z.enum(["MONTH", "YEAR"]).optional(),
      })
      .refine((r) => (r.capMinor === undefined) === (r.capWindow === undefined), {
        message: "capMinor and capWindow must be set together",
      }),
  ),
  credits: z.array(
    z.object({
      id: z.string().trim().min(1).max(40),
      label: z.string().trim().min(1).max(80),
      valueMinor: minor.positive(),
      period: z.enum(["YEAR", "MONTH"]),
    }),
  ),
});

export const cardImportEntry = z.object({
  nickname: z.string().trim().min(1).max(60),
  issuer: z.string().trim().min(1).max(60),
  network: z.enum(["VISA", "MASTERCARD", "AMEX"]),
  lastFour: z.string().regex(/^\d{4}$/).optional(),
  country: z.string().regex(/^[A-Z]{2}$/).default("CA"),
  currency: currencyCode.default("CAD"),
  limitMinor: minor.positive().optional(),
  statementDay: z.coerce.number().int().min(1).max(28).optional(),
  dueDay: z.coerce.number().int().min(1).max(28).optional(),
  aprPct: z.coerce.number().min(0).max(50).optional(),
  annualFeeMinor: minor.default(0),
  rewards: cardRewardsInput,
});
```

Run: `npm test` — expect pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/cards/ src/lib/validation/cards.*
git commit -m "feat: add card types, rewards validation, and invented fixtures"
```

---

### Task 3: Engine — effective return + recommendation

**Files:**
- Create: `src/engine/cards/picker.ts`, `src/engine/cards/picker.test.ts`

**Interfaces:**
- Consumes: card types + fixtures.
- Produces:
  - `interface PurchaseCtx { category: SpendCategory; amexAccepted: boolean; foreign: boolean; networkRestriction: Network | null; today: string }`
  - `effectiveReturnPct(card: CardDef, ctx: PurchaseCtx, capUsage: CapUsage[]): { pct: number; why: string } | null` — null when the card is unusable for this purchase (network excluded).
  - `interface Pick { cardId: string; nickname: string; pct: number; why: string }`
  - `recommend(cards: CardDef[], ctx: PurchaseCtx, capUsage: CapUsage[]): { best: Pick | null; runnerUp: Pick | null }`

- [ ] **Step 1: Write the failing test**

Create `src/engine/cards/picker.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FIXTURE_CARDS } from "./fixtures";
import { effectiveReturnPct, recommend, type PurchaseCtx } from "./picker";

const baseCtx: PurchaseCtx = {
  category: "everything_else",
  amexAccepted: true,
  foreign: false,
  networkRestriction: null,
  today: "2026-08-15",
};

const [alpha, beta, gamma] = FIXTURE_CARDS;

describe("effectiveReturnPct", () => {
  it("multiplies category rate by point value", () => {
    const result = effectiveReturnPct(alpha, { ...baseCtx, category: "dining" }, []);
    expect(result?.pct).toBeCloseTo(6); // 5 × 1.2
    expect(result?.why).toContain("5×");
  });

  it("falls back to the base multiplier without a category rate", () => {
    expect(effectiveReturnPct(gamma, { ...baseCtx, category: "dining" }, [])?.pct).toBeCloseTo(2);
  });

  it("subtracts the FX fee on foreign purchases", () => {
    expect(effectiveReturnPct(beta, { ...baseCtx, foreign: true }, [])?.pct).toBeCloseTo(-1); // 1.5 − 2.5
    expect(effectiveReturnPct(gamma, { ...baseCtx, foreign: true }, [])?.pct).toBeCloseTo(2); // 0% FX
  });

  it("excludes Amex where not accepted and non-matching networks under a restriction", () => {
    expect(effectiveReturnPct(alpha, { ...baseCtx, amexAccepted: false }, [])).toBeNull();
    expect(effectiveReturnPct(beta, { ...baseCtx, networkRestriction: "MASTERCARD" }, [])).toBeNull();
    expect(effectiveReturnPct(gamma, { ...baseCtx, networkRestriction: "MASTERCARD" }, [])).not.toBeNull();
  });

  it("demotes a capped-out category to the base rate", () => {
    const ctx: PurchaseCtx = { ...baseCtx, category: "groceries" };
    const full = effectiveReturnPct(alpha, ctx, []);
    expect(full?.pct).toBeCloseTo(4.8); // 4 × 1.2
    const capped = effectiveReturnPct(alpha, ctx, [
      { cardId: "alpha", category: "groceries", periodKey: "2026-08", usedMinor: 150_000 },
    ]);
    expect(capped?.pct).toBeCloseTo(1.2); // base 1 × 1.2
    expect(capped?.why).toContain("cap");
  });

  it("ignores cap usage from other periods", () => {
    const ctx: PurchaseCtx = { ...baseCtx, category: "groceries" };
    const lastMonth = effectiveReturnPct(alpha, ctx, [
      { cardId: "alpha", category: "groceries", periodKey: "2026-07", usedMinor: 150_000 },
    ]);
    expect(lastMonth?.pct).toBeCloseTo(4.8);
  });
});

describe("recommend", () => {
  it("ranks best and runner-up for groceries with Amex accepted", () => {
    const { best, runnerUp } = recommend(FIXTURE_CARDS, { ...baseCtx, category: "groceries" }, []);
    expect(best?.cardId).toBe("alpha"); // 4.8%
    expect(runnerUp?.cardId).toBe("beta"); // 3%
  });

  it("re-ranks when Amex is not accepted", () => {
    const { best } = recommend(FIXTURE_CARDS, { ...baseCtx, category: "groceries", amexAccepted: false }, []);
    expect(best?.cardId).toBe("beta");
  });

  it("prefers the no-FX card on foreign purchases", () => {
    const { best } = recommend(FIXTURE_CARDS, { ...baseCtx, foreign: true }, []);
    expect(best?.cardId).toBe("gamma");
  });

  it("returns null best with no usable cards", () => {
    const { best } = recommend([alpha], { ...baseCtx, amexAccepted: false }, []);
    expect(best).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure, implement**

Run: `npm test` — FAIL. Create `src/engine/cards/picker.ts`:

```ts
import { periodKeyFor, type CapUsage, type CardDef, type Network, type SpendCategory } from "./types";

export interface PurchaseCtx {
  category: SpendCategory;
  amexAccepted: boolean;
  foreign: boolean;
  networkRestriction: Network | null;
  today: string;
}

export interface Pick {
  cardId: string;
  nickname: string;
  pct: number;
  why: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function effectiveReturnPct(
  card: CardDef,
  ctx: PurchaseCtx,
  capUsage: CapUsage[],
): { pct: number; why: string } | null {
  if (ctx.networkRestriction && card.network !== ctx.networkRestriction) return null;
  if (!ctx.amexAccepted && card.network === "AMEX") return null;

  const rate = card.rewards.categoryRates.find((r) => r.category === ctx.category);
  let multiplier = card.rewards.baseMultiplier;
  let capNote = "";

  if (rate) {
    const overCap =
      rate.capMinor !== undefined &&
      capUsage.some(
        (u) =>
          u.cardId === card.id &&
          u.category === ctx.category &&
          u.periodKey === periodKeyFor(rate.capWindow ?? "MONTH", ctx.today) &&
          u.usedMinor >= (rate.capMinor ?? 0),
      );
    if (overCap) {
      capNote = " (category cap reached — base rate)";
    } else {
      multiplier = rate.multiplier;
    }
  }

  const gross = multiplier * card.rewards.pointValueCents;
  const fx = ctx.foreign ? card.rewards.fxFeePct : 0;
  const pct = gross - fx;

  const why =
    `${multiplier}× at ${card.rewards.pointValueCents}¢/pt = ${round1(gross)}%` +
    (fx > 0 ? ` − ${fx}% FX` : "") +
    capNote;

  return { pct, why };
}

export function recommend(
  cards: CardDef[],
  ctx: PurchaseCtx,
  capUsage: CapUsage[],
): { best: Pick | null; runnerUp: Pick | null } {
  const ranked = cards
    .map((card) => {
      const result = effectiveReturnPct(card, ctx, capUsage);
      return result === null
        ? null
        : { cardId: card.id, nickname: card.nickname, pct: result.pct, why: result.why };
    })
    .filter((p): p is Pick => p !== null)
    .sort((a, b) => b.pct - a.pct);

  return { best: ranked[0] ?? null, runnerUp: ranked[1] ?? null };
}
```

Run: `npm test` — expect pass (hand-checks: dining Alpha 5×1.2 = 6%; groceries Alpha 4×1.2 = 4.8% vs Beta 3×1 = 3%; foreign Beta 1.5−2.5 = −1 vs Gamma 2−0 = 2).

- [ ] **Step 3: Commit**

```bash
git add src/engine/cards/picker.*
git commit -m "feat: add data-driven card recommendation engine"
```

---

### Task 4: Engine — cheat sheet + fee-ROI verdicts

**Files:**
- Create: `src/engine/cards/roi.ts`, `src/engine/cards/roi.test.ts`

**Interfaces:**
- Consumes: picker, types, fixtures.
- Produces:
  - `cheatSheet(cards: CardDef[], today: string): Array<{ category: SpendCategory; best: Pick | null; runnerUp: Pick | null }>` — default context (Amex accepted, domestic, no restriction), no cap usage.
  - `interface RedeemedCredit { creditId: string; periodKey: string }`
  - `cardVerdict(card: CardDef, redeemed: RedeemedCredit[], rewardsEstimateMinor: number, isBestSomewhere: boolean, today: string): { realizedMinor: number; netMinor: number; verdict: "KEEP" | "DOWNGRADE" | "CANCEL_CANDIDATE" }` — realized = current-period redeemed credit values + rewards estimate; net = realized − fee; KEEP when fee is zero or net ≥ 0; DOWNGRADE when net < 0 but the card is still best somewhere; CANCEL_CANDIDATE otherwise.

- [ ] **Step 1: Write the failing test**

Create `src/engine/cards/roi.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FIXTURE_CARDS } from "./fixtures";
import { cardVerdict, cheatSheet } from "./roi";

const [alpha, beta, gamma] = FIXTURE_CARDS;
const today = "2026-08-15";

describe("cheatSheet", () => {
  it("maps every category to its default best card", () => {
    const sheet = cheatSheet(FIXTURE_CARDS, today);
    const by = Object.fromEntries(sheet.map((row) => [row.category, row]));
    expect(by.dining.best?.cardId).toBe("alpha"); // 6%
    expect(by.groceries.best?.cardId).toBe("alpha"); // 4.8%
    expect(by.groceries.runnerUp?.cardId).toBe("beta"); // 3%
    expect(by.everything_else.best?.cardId).toBe("gamma"); // 2%
    expect(by.online_foreign.best?.cardId).toBe("gamma"); // only non-negative net abroad
    expect(sheet).toHaveLength(11);
  });
});

describe("cardVerdict", () => {
  it("keeps a no-fee card unconditionally", () => {
    expect(cardVerdict(beta, [], 0, false, today).verdict).toBe("KEEP");
  });

  it("keeps a fee card whose realized value covers the fee", () => {
    const v = cardVerdict(alpha, [{ creditId: "dine100", periodKey: "2026" }], 6_000, true, today);
    expect(v.realizedMinor).toBe(16_000); // 10,000 credit + 6,000 estimate
    expect(v.netMinor).toBe(1_000);
    expect(v.verdict).toBe("KEEP");
  });

  it("downgrades a losing card that still wins somewhere", () => {
    const v = cardVerdict(alpha, [{ creditId: "dine100", periodKey: "2026" }], 4_000, true, today);
    expect(v.netMinor).toBe(-1_000);
    expect(v.verdict).toBe("DOWNGRADE");
  });

  it("cancel-candidates a losing card that wins nowhere", () => {
    const v = cardVerdict(gamma, [], 0, false, today);
    expect(v.netMinor).toBe(-12_000);
    expect(v.verdict).toBe("CANCEL_CANDIDATE");
  });

  it("ignores credits redeemed in other periods", () => {
    const v = cardVerdict(alpha, [{ creditId: "dine100", periodKey: "2025" }], 0, true, today);
    expect(v.realizedMinor).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure, implement**

Run: `npm test` — FAIL. Create `src/engine/cards/roi.ts`:

```ts
import { effectiveReturnPct, recommend, type Pick, type PurchaseCtx } from "./picker";
import { periodKeyFor, SPEND_CATEGORIES, type CardDef, type SpendCategory } from "./types";

export function cheatSheet(
  cards: CardDef[],
  today: string,
): Array<{ category: SpendCategory; best: Pick | null; runnerUp: Pick | null }> {
  return SPEND_CATEGORIES.map((category) => {
    const ctx: PurchaseCtx = {
      category,
      amexAccepted: true,
      foreign: category === "online_foreign",
      networkRestriction: category === "warehouse" ? "MASTERCARD" : null,
      today,
    };
    return { category, ...recommend(cards, ctx, []) };
  });
}

export interface RedeemedCredit {
  creditId: string;
  periodKey: string;
}

export function cardVerdict(
  card: CardDef,
  redeemed: RedeemedCredit[],
  rewardsEstimateMinor: number,
  isBestSomewhere: boolean,
  today: string,
): { realizedMinor: number; netMinor: number; verdict: "KEEP" | "DOWNGRADE" | "CANCEL_CANDIDATE" } {
  const creditValue = card.rewards.credits.reduce((sum, credit) => {
    const key = periodKeyFor(credit.period, today);
    const wasRedeemed = redeemed.some((r) => r.creditId === credit.id && r.periodKey === key);
    return sum + (wasRedeemed ? credit.valueMinor : 0);
  }, 0);

  const realizedMinor = creditValue + rewardsEstimateMinor;
  const netMinor = realizedMinor - card.annualFeeMinor;
  const verdict =
    card.annualFeeMinor === 0 || netMinor >= 0
      ? "KEEP"
      : isBestSomewhere
        ? "DOWNGRADE"
        : "CANCEL_CANDIDATE";

  return { realizedMinor, netMinor, verdict };
}

export function isBestSomewhere(card: CardDef, cards: CardDef[], today: string): boolean {
  return cheatSheet(cards, today).some((row) => row.best?.cardId === card.id);
}
```

Note: the `cheatSheet` warehouse row models the public "warehouse clubs are often Mastercard-only in-store" fact; `online_foreign` applies FX. Both are context defaults, not card facts.

Run: `npm test` — expect pass.

- [ ] **Step 3: Commit**

```bash
git add src/engine/cards/roi.*
git commit -m "feat: add cheat sheet and fee-ROI verdict engine"
```

---

### Task 5: Merchant module — public retail facts

**Files:**
- Create: `src/engine/cards/merchants.ts`, `src/engine/cards/merchants.test.ts`

**Interfaces:**
- Produces: `interface MerchantFact { name: string; category: SpendCategory; networkRestriction?: Network; amexAccepted?: boolean; note?: string }`, `MERCHANTS: MerchantFact[]` (public Canadian retail facts only), `matchMerchant(query: string): MerchantFact[]` (case-insensitive substring match, best-first).

- [ ] **Step 1: Failing test**

Create `src/engine/cards/merchants.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { matchMerchant } from "./merchants";

describe("matchMerchant", () => {
  it("finds warehouse clubs with their network restriction", () => {
    const [hit] = matchMerchant("costco");
    expect(hit.category).toBe("warehouse");
    expect(hit.networkRestriction).toBe("MASTERCARD");
  });

  it("knows discount grocers that decline Amex", () => {
    const [hit] = matchMerchant("no frills");
    expect(hit.category).toBe("groceries");
    expect(hit.amexAccepted).toBe(false);
  });

  it("matches case-insensitively on substrings", () => {
    expect(matchMerchant("COST")[0]?.name).toBe("Costco (in-store)");
  });

  it("returns empty for unknown merchants", () => {
    expect(matchMerchant("zzz-unknown")).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement**

Create `src/engine/cards/merchants.ts`:

```ts
import type { Network, SpendCategory } from "./types";

export interface MerchantFact {
  name: string;
  category: SpendCategory;
  networkRestriction?: Network;
  amexAccepted?: boolean;
  note?: string;
}

// Public retail facts (Canada). Acceptance changes — the UI hedges with "verify at the till".
export const MERCHANTS: MerchantFact[] = [
  { name: "Costco (in-store)", category: "warehouse", networkRestriction: "MASTERCARD", note: "Mastercard only in-store in Canada" },
  { name: "Costco.ca (online)", category: "warehouse", note: "Online accepts more networks than in-store" },
  { name: "No Frills", category: "groceries", amexAccepted: false, note: "Generally does not accept Amex" },
  { name: "Food Basics", category: "groceries", amexAccepted: false, note: "Generally does not accept Amex" },
  { name: "Loblaws", category: "groceries" },
  { name: "Metro", category: "groceries" },
  { name: "Walmart", category: "everything_else", note: "Often not coded as grocery MCC" },
  { name: "Canadian Tire", category: "home_improvement" },
  { name: "Home Depot", category: "home_improvement" },
  { name: "Uber Eats", category: "dining" },
  { name: "Tim Hortons", category: "dining" },
  { name: "Petro-Canada", category: "gas" },
  { name: "Esso", category: "gas" },
  { name: "Netflix", category: "streaming" },
  { name: "Spotify", category: "streaming" },
  { name: "Marriott", category: "hotel" },
  { name: "Air Canada", category: "travel" },
  { name: "Amazon.ca", category: "everything_else" },
];

export function matchMerchant(query: string): MerchantFact[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  return MERCHANTS.filter((m) => m.name.toLowerCase().includes(q));
}
```

Run: `npm test` — expect pass.

- [ ] **Step 3: Commit**

```bash
git add src/engine/cards/merchants.*
git commit -m "feat: add public merchant acceptance facts with fuzzy match"
```

---

### Task 6: Actions + import extension

**Files:**
- Create: `src/app/cards/actions.ts`
- Modify: `src/lib/validation/investments.ts` (`importFile` gains `cards[]`), `src/app/investments/import/actions.ts` (cards loop + count), `docs/import-format.md`

**Interfaces:**
- Produces: server actions `addCapUsage(cardId, category, amountMinor)` (accumulates into the current period key), `toggleCredit(cardId, creditId)` (redeem/un-redeem for the current period), `setRewardsEstimate(cardId, estimateMinor)`, `deleteCard(cardId)`; import upserts cards by `(userId, nickname)` and resets nothing in `CardState`.

- [ ] **Step 1: Implement the actions**

Create `src/app/cards/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { periodKeyFor, type CapUsage, type SpendCategory } from "@/engine/cards/types";
import type { CardRewards } from "@/engine/cards/types";
import type { RedeemedCredit } from "@/engine/cards/roi";
import { SPEND_CATEGORIES } from "@/engine/cards/types";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

type ActionResult = { ok: true } | { ok: false; error: string };

async function ownedCard(userId: string, cardId: string) {
  const card = await prisma.creditCard.findFirst({ where: { id: cardId, userId }, include: { state: true } });
  if (!card) throw new Error("Card not found");
  return card;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function addCapUsage(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const cardId = String(formData.get("cardId") ?? "");
  const category = String(formData.get("category") ?? "") as SpendCategory;
  const amountMinor = Number(formData.get("amountMinor"));
  if (!SPEND_CATEGORIES.includes(category)) return { ok: false, error: "Bad category" };
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return { ok: false, error: "Bad amount" };
  try {
    const card = await ownedCard(userId, cardId);
    const rewards = card.rewards as unknown as CardRewards;
    const rate = rewards.categoryRates.find((r) => r.category === category);
    const window = rate?.capWindow ?? "MONTH";
    const periodKey = periodKeyFor(window, today());
    const usage = ((card.state?.capsUsage as unknown as CapUsage[]) ?? []).slice();
    const existing = usage.find((u) => u.category === category && u.periodKey === periodKey);
    if (existing) existing.usedMinor += amountMinor;
    else usage.push({ cardId, category, periodKey, usedMinor: amountMinor });
    await prisma.cardState.upsert({
      where: { cardId },
      update: { capsUsage: usage },
      create: { cardId, capsUsage: usage },
    });
    revalidatePath("/cards");
    revalidatePath(`/cards/${cardId}`);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
  return { ok: true };
}

export async function toggleCredit(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const cardId = String(formData.get("cardId") ?? "");
  const creditId = String(formData.get("creditId") ?? "");
  try {
    const card = await ownedCard(userId, cardId);
    const rewards = card.rewards as unknown as CardRewards;
    const credit = rewards.credits.find((c) => c.id === creditId);
    if (!credit) return { ok: false, error: "Unknown credit" };
    const periodKey = periodKeyFor(credit.period, today());
    let redeemed = ((card.state?.creditsRedeemed as unknown as RedeemedCredit[]) ?? []).slice();
    const already = redeemed.some((r) => r.creditId === creditId && r.periodKey === periodKey);
    redeemed = already
      ? redeemed.filter((r) => !(r.creditId === creditId && r.periodKey === periodKey))
      : [...redeemed, { creditId, periodKey }];
    await prisma.cardState.upsert({
      where: { cardId },
      update: { creditsRedeemed: redeemed },
      create: { cardId, creditsRedeemed: redeemed },
    });
    revalidatePath(`/cards/${cardId}`);
    revalidatePath("/cards/manage");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
  return { ok: true };
}

export async function setRewardsEstimate(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const cardId = String(formData.get("cardId") ?? "");
  const estimate = Number(formData.get("rewardsEstimateMinor"));
  if (!Number.isSafeInteger(estimate) || estimate < 0) return { ok: false, error: "Bad estimate" };
  try {
    await ownedCard(userId, cardId);
    await prisma.cardState.upsert({
      where: { cardId },
      update: { rewardsEstimateMinor: estimate },
      create: { cardId, rewardsEstimateMinor: estimate },
    });
    revalidatePath(`/cards/${cardId}`);
    revalidatePath("/cards/manage");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
  return { ok: true };
}

export async function deleteCard(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    const card = await ownedCard(userId, String(formData.get("cardId") ?? ""));
    await prisma.creditCard.delete({ where: { id: card.id } });
    revalidatePath("/cards");
    revalidatePath("/cards/manage");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
  return { ok: true };
}
```

- [ ] **Step 2: Extend the import**

In `src/lib/validation/investments.ts`, add to `importFile` (import `cardImportEntry` from `./cards`):

```ts
  cards: z.array(cardImportEntry).optional(),
```

In `src/app/investments/import/actions.ts`, add a `cards` counter and after the bills loop:

```ts
  for (const c of parsed.data.cards ?? []) {
    const { rewards, ...core } = c;
    await prisma.creditCard.upsert({
      where: { userId_nickname: { userId, nickname: core.nickname } },
      update: { ...core, rewards },
      create: { ...core, userId, rewards },
    });
    cards += 1;
  }
```

Include `cards` in `ImportResult` and the success message (`…, ${result.cards} cards`). Document `cards[]` in `docs/import-format.md` (fields of `cardImportEntry`; `rewards` structure with `pointValueCents`, `fxFeePct`, `baseMultiplier`, `categoryRates[]` (cap fields together), `credits[]`; idempotent on `nickname`; **reminder: this file documents the format with invented examples only**).

- [ ] **Step 3: Verify + commit**

Run: `npm test && npm run lint && npm run build` — expect pass.

```bash
git add src/app/cards/actions.ts src/lib/validation/investments.ts src/app/investments/import/ docs/import-format.md
git commit -m "feat: add card state actions and import support"
```

---

### Task 7: Picker UI + cheat sheet

**Files:**
- Modify: `src/app/cards/page.tsx` (replace placeholder)
- Create: `src/components/card-picker.tsx`, `src/app/cards/cheatsheet/page.tsx`

**Interfaces:**
- Consumes: engine picker/roi/merchants, DB cards + state.
- Produces: `/cards` — the instant picker (category grid, context chips, merchant search; answer card with best + runner-up + why; ≤2 taps); `/cards/cheatsheet` — printable category → card table.

- [ ] **Step 1: Server page**

Replace `src/app/cards/page.tsx` entirely with:

```tsx
import Link from "next/link";
import { CardPicker } from "@/components/card-picker";
import type { CapUsage, CardDef, CardRewards } from "@/engine/cards/types";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export default async function CardsPage() {
  const userId = await requireUserId();
  const cards = await prisma.creditCard.findMany({
    where: { userId },
    include: { state: true },
    orderBy: { nickname: "asc" },
  });

  const defs: CardDef[] = cards.map((c) => ({
    id: c.id,
    nickname: c.nickname,
    network: c.network as CardDef["network"],
    annualFeeMinor: c.annualFeeMinor,
    rewards: c.rewards as unknown as CardRewards,
  }));
  const capUsage: CapUsage[] = cards.flatMap(
    (c) => ((c.state?.capsUsage as unknown as CapUsage[]) ?? []).map((u) => ({ ...u, cardId: c.id })),
  );

  return (
    <main className="space-y-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Which card?</h1>
        <div className="flex gap-2 text-sm">
          <Link href="/cards/cheatsheet" className="rounded border px-3 py-1">Cheat sheet</Link>
          <Link href="/cards/manage" className="rounded border px-3 py-1">Manage</Link>
        </div>
      </div>
      {defs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No cards yet — add them via <Link href="/investments/import" className="underline">Import</Link>.
        </p>
      ) : (
        <CardPicker cards={defs} capUsage={capUsage} today={new Date().toISOString().slice(0, 10)} />
      )}
    </main>
  );
}
```

- [ ] **Step 2: Picker client component**

Create `src/components/card-picker.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { matchMerchant, type MerchantFact } from "@/engine/cards/merchants";
import { recommend, type PurchaseCtx } from "@/engine/cards/picker";
import {
  CATEGORY_LABELS,
  SPEND_CATEGORIES,
  type CapUsage,
  type CardDef,
  type SpendCategory,
} from "@/engine/cards/types";

export function CardPicker({
  cards,
  capUsage,
  today,
}: {
  cards: CardDef[];
  capUsage: CapUsage[];
  today: string;
}) {
  const [category, setCategory] = useState<SpendCategory | null>(null);
  const [amexAccepted, setAmexAccepted] = useState(true);
  const [foreign, setForeign] = useState(false);
  const [merchant, setMerchant] = useState<MerchantFact | null>(null);
  const [query, setQuery] = useState("");

  const matches = useMemo(() => matchMerchant(query).slice(0, 5), [query]);

  const effectiveCategory = merchant?.category ?? category;
  const ctx: PurchaseCtx | null = effectiveCategory
    ? {
        category: effectiveCategory,
        amexAccepted: merchant?.amexAccepted === false ? false : amexAccepted,
        foreign: effectiveCategory === "online_foreign" ? true : foreign,
        networkRestriction: merchant?.networkRestriction ?? null,
        today,
      }
    : null;
  const answer = ctx ? recommend(cards, ctx, capUsage) : null;

  return (
    <div className="space-y-4">
      <div>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setMerchant(null);
          }}
          placeholder="Merchant search (e.g. Costco)…"
          className="w-full rounded border px-3 py-2 text-sm"
        />
        {matches.length > 0 && !merchant ? (
          <ul className="mt-1 rounded border text-sm">
            {matches.map((m) => (
              <li key={m.name}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left hover:bg-muted/50"
                  onClick={() => {
                    setMerchant(m);
                    setQuery(m.name);
                  }}
                >
                  {m.name} <span className="text-xs text-muted-foreground">{CATEGORY_LABELS[m.category]}{m.note ? ` · ${m.note}` : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {SPEND_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              setCategory(c);
              setMerchant(null);
              setQuery("");
            }}
            className={`rounded border px-3 py-3 text-sm ${effectiveCategory === c ? "bg-foreground text-background" : ""}`}
          >
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={amexAccepted} onChange={(e) => setAmexAccepted(e.target.checked)} />
          Amex accepted here
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={foreign} onChange={(e) => setForeign(e.target.checked)} />
          Foreign currency
        </label>
      </div>

      {answer ? (
        <div className="rounded border p-4" data-testid="picker-answer">
          {answer.best ? (
            <>
              <p className="text-lg font-semibold">{answer.best.nickname}</p>
              <p className="text-sm text-muted-foreground">
                {answer.best.pct.toFixed(1)}% — {answer.best.why}
              </p>
              {answer.runnerUp ? (
                <p className="mt-2 text-sm">
                  Runner-up: {answer.runnerUp.nickname} ({answer.runnerUp.pct.toFixed(1)}%)
                </p>
              ) : null}
              {merchant?.note ? (
                <p className="mt-2 text-xs text-muted-foreground">{merchant.note} — verify at the till.</p>
              ) : null}
            </>
          ) : (
            <p className="text-sm">No usable card for this context.</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Pick a category or merchant.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Cheat sheet page**

Create `src/app/cards/cheatsheet/page.tsx`:

```tsx
import { cheatSheet } from "@/engine/cards/roi";
import { CATEGORY_LABELS, type CardDef, type CardRewards } from "@/engine/cards/types";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export default async function CheatSheetPage() {
  const userId = await requireUserId();
  const cards = await prisma.creditCard.findMany({ where: { userId } });
  const defs: CardDef[] = cards.map((c) => ({
    id: c.id,
    nickname: c.nickname,
    network: c.network as CardDef["network"],
    annualFeeMinor: c.annualFeeMinor,
    rewards: c.rewards as unknown as CardRewards,
  }));
  const sheet = cheatSheet(defs, new Date().toISOString().slice(0, 10));

  return (
    <main className="py-8 print:py-0">
      <h1 className="text-xl font-semibold print:text-base">Wallet cheat sheet</h1>
      <table className="mt-4 w-full text-sm">
        <tbody>
          {sheet.map((row) => (
            <tr key={row.category} className="border-b">
              <td className="py-2 pr-4 font-medium">{CATEGORY_LABELS[row.category]}</td>
              <td className="py-2">
                {row.best ? (
                  <>
                    {row.best.nickname}{" "}
                    <span className="text-xs text-muted-foreground">({row.best.pct.toFixed(1)}%)</span>
                  </>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-xs text-muted-foreground print:hidden">
        Defaults assume Amex accepted and domestic currency; warehouse assumes Mastercard-only.
        Print or screenshot for the wallet.
      </p>
    </main>
  );
}
```

- [ ] **Step 4: Verify + commit**

Run: `npm run dev` — with fictional cards imported: picker answers in ≤2 taps, chips re-rank, merchant search applies restrictions, cheat sheet prints cleanly. `npm test && npm run lint && npm run build`.

```bash
git add src/app/cards/ src/components/card-picker.tsx
git commit -m "feat: add instant card picker and wallet cheat sheet"
```

---

### Task 8: Manage/detail UI + dashboard card due dates

**Files:**
- Create: `src/app/cards/manage/page.tsx`, `src/app/cards/[id]/page.tsx`
- Modify: `src/app/page.tsx` (card due dates in the 14-day strip)

**Interfaces:**
- Consumes: engine roi/types, actions from Task 6.
- Produces: `/cards/manage` — all cards with fee, net ROI, verdict chip; `/cards/[id]` — credits checklist (toggle per period), caps meters with quick-add, rewards estimate input, verdict readout, delete; dashboard strip gains `💳 <nickname> payment due` entries derived from `dueDay` within the next 14 days.

- [ ] **Step 1: Manage page**

Create `src/app/cards/manage/page.tsx`:

```tsx
import Link from "next/link";
import { cardVerdict, isBestSomewhere, type RedeemedCredit } from "@/engine/cards/roi";
import type { CardDef, CardRewards } from "@/engine/cards/types";
import { formatMinorUnits } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

const VERDICT_STYLES: Record<string, string> = {
  KEEP: "bg-green-700 text-white",
  DOWNGRADE: "bg-amber-500 text-black",
  CANCEL_CANDIDATE: "bg-red-600 text-white",
};

export default async function ManageCardsPage() {
  const userId = await requireUserId();
  const cards = await prisma.creditCard.findMany({
    where: { userId },
    include: { state: true },
    orderBy: { nickname: "asc" },
  });
  const today = new Date().toISOString().slice(0, 10);
  const defs: CardDef[] = cards.map((c) => ({
    id: c.id,
    nickname: c.nickname,
    network: c.network as CardDef["network"],
    annualFeeMinor: c.annualFeeMinor,
    rewards: c.rewards as unknown as CardRewards,
  }));

  return (
    <main className="space-y-6 py-8">
      <h1 className="text-xl font-semibold">Manage cards</h1>
      <ul className="divide-y rounded border">
        {cards.map((c, i) => {
          const def = defs[i];
          const verdict = cardVerdict(
            def,
            ((c.state?.creditsRedeemed as unknown as RedeemedCredit[]) ?? []),
            c.state?.rewardsEstimateMinor ?? 0,
            isBestSomewhere(def, defs, today),
            today,
          );
          return (
            <li key={c.id}>
              <Link href={`/cards/${c.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-muted/50">
                <span>
                  <span className="font-medium">{c.nickname}</span>{" "}
                  <span className="text-xs text-muted-foreground">{c.issuer} · {c.network}</span>
                </span>
                <span className="flex items-center gap-3 text-sm tabular-nums">
                  fee {formatMinorUnits(c.annualFeeMinor, "CAD")} · net {formatMinorUnits(verdict.netMinor, "CAD")}
                  <span className={`rounded px-2 py-0.5 text-xs ${VERDICT_STYLES[verdict.verdict]}`}>
                    {verdict.verdict.replace("_", " ")}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Detail page**

Create `src/app/cards/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { addCapUsage, deleteCard, setRewardsEstimate, toggleCredit } from "@/app/cards/actions";
import { cardVerdict, isBestSomewhere, type RedeemedCredit } from "@/engine/cards/roi";
import {
  CATEGORY_LABELS,
  periodKeyFor,
  type CapUsage,
  type CardDef,
  type CardRewards,
} from "@/engine/cards/types";
import { formatMinorUnits } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export default async function CardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  const card = await prisma.creditCard.findFirst({ where: { id, userId }, include: { state: true } });
  if (!card) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const rewards = card.rewards as unknown as CardRewards;
  const redeemed = ((card.state?.creditsRedeemed as unknown as RedeemedCredit[]) ?? []);
  const usage = ((card.state?.capsUsage as unknown as CapUsage[]) ?? []);

  const allCards = await prisma.creditCard.findMany({ where: { userId } });
  const defs: CardDef[] = allCards.map((c) => ({
    id: c.id,
    nickname: c.nickname,
    network: c.network as CardDef["network"],
    annualFeeMinor: c.annualFeeMinor,
    rewards: c.rewards as unknown as CardRewards,
  }));
  const def = defs.find((d) => d.id === card.id)!;
  const verdict = cardVerdict(
    def,
    redeemed,
    card.state?.rewardsEstimateMinor ?? 0,
    isBestSomewhere(def, defs, today),
    today,
  );

  return (
    <main className="space-y-8 py-8">
      <header>
        <h1 className="text-xl font-semibold">{card.nickname}</h1>
        <p className="text-sm text-muted-foreground">
          {card.issuer} · {card.network}
          {card.lastFour ? ` · …${card.lastFour}` : ""} · fee {formatMinorUnits(card.annualFeeMinor, "CAD")}/yr
        </p>
        <p className="mt-2 text-sm">
          Realized value {formatMinorUnits(verdict.realizedMinor, "CAD")} − fee ={" "}
          <span className="font-medium tabular-nums">{formatMinorUnits(verdict.netMinor, "CAD")}</span>{" "}
          → <span className="font-semibold">{verdict.verdict.replace("_", " ")}</span>
        </p>
      </header>

      {rewards.credits.length > 0 ? (
        <section>
          <h2 className="font-medium">Credits checklist</h2>
          <ul className="mt-2 divide-y rounded border">
            {rewards.credits.map((credit) => {
              const key = periodKeyFor(credit.period, today);
              const done = redeemed.some((r) => r.creditId === credit.id && r.periodKey === key);
              return (
                <li key={credit.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span>
                    {credit.label}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({formatMinorUnits(credit.valueMinor, "CAD")}/{credit.period.toLowerCase()})
                    </span>
                  </span>
                  <form action={toggleCredit}>
                    <input type="hidden" name="cardId" value={card.id} />
                    <input type="hidden" name="creditId" value={credit.id} />
                    <button type="submit" className="rounded border px-2 py-0.5 text-xs">
                      {done ? "✓ redeemed — undo" : "mark redeemed"}
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {rewards.categoryRates.some((r) => r.capMinor !== undefined) ? (
        <section>
          <h2 className="font-medium">Caps</h2>
          <ul className="mt-2 divide-y rounded border">
            {rewards.categoryRates
              .filter((r) => r.capMinor !== undefined)
              .map((rate) => {
                const key = periodKeyFor(rate.capWindow ?? "MONTH", today);
                const used = usage
                  .filter((u) => u.category === rate.category && u.periodKey === key)
                  .reduce((sum, u) => sum + u.usedMinor, 0);
                const pct = Math.min(100, Math.round((used / (rate.capMinor ?? 1)) * 100));
                return (
                  <li key={rate.category} className="space-y-1 px-4 py-2 text-sm">
                    <div className="flex justify-between">
                      <span>{CATEGORY_LABELS[rate.category]} ({rate.capWindow?.toLowerCase()})</span>
                      <span className="tabular-nums">
                        {formatMinorUnits(used, "CAD")} / {formatMinorUnits(rate.capMinor ?? 0, "CAD")} ({pct}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded bg-muted">
                      <div className="h-1.5 rounded bg-foreground" style={{ width: `${pct}%` }} />
                    </div>
                    <form action={addCapUsage} className="flex gap-2">
                      <input type="hidden" name="cardId" value={card.id} />
                      <input type="hidden" name="category" value={rate.category} />
                      <input name="amountMinor" placeholder="Add spend (cents)" className="w-36 rounded border px-2 py-0.5 text-xs" />
                      <button type="submit" className="rounded border px-2 py-0.5 text-xs">add</button>
                    </form>
                  </li>
                );
              })}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="font-medium">Rewards earned this year (estimate)</h2>
        <form action={setRewardsEstimate} className="mt-2 flex gap-2 text-sm">
          <input type="hidden" name="cardId" value={card.id} />
          <input
            name="rewardsEstimateMinor"
            defaultValue={card.state?.rewardsEstimateMinor ?? 0}
            className="w-40 rounded border px-2 py-1"
          />
          <button type="submit" className="rounded border px-3 py-1">Save (cents)</button>
        </form>
      </section>

      <form action={deleteCard}>
        <input type="hidden" name="cardId" value={card.id} />
        <button type="submit" className="rounded border border-red-600 px-3 py-1 text-sm text-red-600">
          Delete card
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Dashboard card due dates**

In `src/app/page.tsx`, load cards with a `dueDay` and add their next due date into the existing 14-day `upcoming` list before sorting:

```tsx
  const dueCards = await prisma.creditCard.findMany({
    where: { userId, dueDay: { not: null } },
    select: { id: true, nickname: true, dueDay: true },
  });
  const cardEntries = dueCards.flatMap((c) => {
    const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
    const candidates = [0, 1].map((offset) => {
      const month = m + offset > 12 ? 1 : m + offset;
      const year = m + offset > 12 ? y + 1 : y;
      return `${year}-${String(month).padStart(2, "0")}-${String(c.dueDay).padStart(2, "0")}`;
    });
    const next = candidates.find((d) => d >= today && d <= in14);
    return next
      ? [{ billId: `card-${c.id}`, billName: `💳 ${c.nickname} payment`, date: next, amountMinor: 0, currency: "CAD", autopay: false, variable: false, paid: false }]
      : [];
  });
```

then `const upcoming = [...billEntries, ...cardEntries].sort(...)` (rename the existing bill list accordingly; render rows with `amountMinor === 0` showing "—" instead of `$0.00`).

- [ ] **Step 4: Verify + commit**

Run: `npm run dev` — manage list shows verdict chips; detail toggles credits and adds cap usage (picker demotes once the cap is reached); dashboard shows a card-payment row when a fictional card's dueDay lands within 14 days. `npm test && npm run lint && npm run build`.

```bash
git add src/app/cards/ src/app/page.tsx
git commit -m "feat: add card management, ROI meters, caps, and due-date strip entries"
```

---

### Task 9: E2E + deploy + real wallet import

**OWNER CHECKPOINT** (Step 3 onward).

**Files:**
- Create: `e2e/fixtures/cards-sample.json`, `e2e/cards.spec.ts`

- [ ] **Step 1: Fixture** — the three invented cards:

Create `e2e/fixtures/cards-sample.json`:

```json
{
  "accounts": [],
  "cards": [
    {
      "nickname": "Fixture Alpha Amex",
      "issuer": "Fixture Financial",
      "network": "AMEX",
      "annualFeeMinor": 15000,
      "dueDay": 15,
      "rewards": {
        "pointValueCents": 1.2,
        "fxFeePct": 2.5,
        "baseMultiplier": 1,
        "categoryRates": [
          { "category": "dining", "multiplier": 5 },
          { "category": "groceries", "multiplier": 4, "capMinor": 150000, "capWindow": "MONTH" }
        ],
        "credits": [{ "id": "dine100", "label": "$100 dining credit", "valueMinor": 10000, "period": "YEAR" }]
      }
    },
    {
      "nickname": "Fixture Beta Visa",
      "issuer": "Fixture Bank",
      "network": "VISA",
      "annualFeeMinor": 0,
      "rewards": {
        "pointValueCents": 1,
        "fxFeePct": 2.5,
        "baseMultiplier": 1.5,
        "categoryRates": [{ "category": "groceries", "multiplier": 3 }],
        "credits": []
      }
    },
    {
      "nickname": "Fixture Gamma MC",
      "issuer": "Fixture Trust",
      "network": "MASTERCARD",
      "annualFeeMinor": 12000,
      "rewards": {
        "pointValueCents": 1,
        "fxFeePct": 0,
        "baseMultiplier": 2,
        "categoryRates": [],
        "credits": [{ "id": "travel90", "label": "$90 travel credit", "valueMinor": 9000, "period": "YEAR" }]
      }
    }
  ]
}
```

- [ ] **Step 2: E2E spec**

Create `e2e/cards.spec.ts`:

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

test("cards end to end", async ({ browser, baseURL }) => {
  const context = await createAuthedContext(browser, baseURL!);
  const page = await context.newPage();

  await page.goto("/investments/import");
  await page
    .locator('input[name="file"]')
    .setInputFiles(path.join(__dirname, "fixtures", "cards-sample.json"));
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText(/3 cards/)).toBeVisible();

  // Picker: groceries with Amex accepted → Alpha; without → Beta (2 taps to an answer)
  await page.goto("/cards");
  await page.getByRole("button", { name: "Groceries" }).click();
  await expect(page.getByTestId("picker-answer")).toContainText("Fixture Alpha Amex");
  await expect(page.getByTestId("picker-answer")).toContainText("4.8%");
  await page.getByLabel("Amex accepted here").uncheck();
  await expect(page.getByTestId("picker-answer")).toContainText("Fixture Beta Visa");

  // Merchant search: warehouse restriction forces the Mastercard
  await page.getByLabel("Amex accepted here").check();
  await page.getByPlaceholder(/Merchant search/).fill("costco");
  await page.getByRole("button", { name: /Costco \(in-store\)/ }).click();
  await expect(page.getByTestId("picker-answer")).toContainText("Fixture Gamma MC");

  // Cheat sheet renders all 11 categories
  await page.goto("/cards/cheatsheet");
  await expect(page.getByText("Dining & delivery")).toBeVisible();
  await expect(page.getByText("Fixture Alpha Amex").first()).toBeVisible();

  // ROI: Alpha starts DOWNGRADE (0 realized vs $150 fee, but best somewhere);
  // redeeming the $100 credit + a $60 estimate flips it to KEEP
  await page.goto("/cards/manage");
  await expect(page.getByText("DOWNGRADE").first()).toBeVisible(); // both fee cards start DOWNGRADE — .first() avoids strict-mode ambiguity
  await page.getByText("Fixture Alpha Amex").click();
  await page.getByRole("button", { name: "mark redeemed" }).click();
  await page.locator('input[name="rewardsEstimateMinor"]').fill("6000");
  await page.getByRole("button", { name: /Save/ }).click();
  await expect(page.getByText("KEEP")).toBeVisible();

  // Caps: filling the grocery cap demotes Alpha in the picker
  await page.locator('input[name="amountMinor"]').fill("150000");
  await page.getByRole("button", { name: "add", exact: true }).click();
  await page.goto("/cards");
  await page.getByRole("button", { name: "Groceries" }).click();
  await expect(page.getByTestId("picker-answer")).toContainText("Fixture Beta Visa");

  await context.close();
});
```

Run: `npm run e2e` — all spec files pass. Full gate: `npm test && npm run lint && npm run build && npm run e2e`.

```bash
git add e2e/
git commit -m "test: add cards E2E acceptance flow"
```

- [ ] **Step 3: OWNER CHECKPOINT — pre-push audit and push**

Audit `git diff origin/main..HEAD`: fixtures and tests must contain only the three invented cards; **explicitly re-confirm with the owner that no real card, rate, fee, cap, or issuer from their wallet appears anywhere in the diff** (the Phase 3 lesson). Then, with permission, `git push origin main`.

- [ ] **Step 4: OWNER CHECKPOINT — real wallet import with web verification**

Working from the owner's real `~/Downloads/files2/cards.json` (never opened into any committed file): build `docs/private/cards-import.json` in the import format. During conversion, honor the source's TASK 0: **web-verify every `needs_verification` field against the issuer's site** (rates, fees, caps, credits change constantly) and resolve the four data toggles the source flags (they become card-level values in the private file — e.g., effective point valuations for cash-vs-travel redemption style, a fee-waiver reflected as `annualFeeMinor: 0`, bill-payment effective rates). The owner then imports on production and verifies: the picker's answers match their known-correct calls for a few real situations, the cheat sheet reads right, and each fee card's ROI meter starts from sensible numbers.

- [ ] **Step 5: Mark Phase 4 done**

All checkboxes checked; spec Phase 4 row satisfied (card data import, instant picker, cheat sheet, fee-ROI meters, caps tracker). Remaining: Phase 5 polish (CSV import with dedupe, January tax-season checklist, Bank of Canada FX auto-fetch, danger-month detector, price auto-fetch, PWA tuning).

---

## Self-review notes

- **Spec coverage (Phase 4 row + CardPilot P0/P1):** instant picker ≤2 taps ✔ (category tap → answer; E2E counts them), context chips ✔ (Amex/foreign; merchant restrictions), merchant search with acceptance quirks ✔ (public facts only), cheat sheet ✔ (printable), fee-ROI with credits checklist + verdicts ✔ (KEEP/DOWNGRADE/CANCEL_CANDIDATE), caps tracker with manual quick-add ✔ (per-period keys, picker demotion), card due dates on the dashboard ✔. CardPilot P2 (statement CSV analyzer) lands with Phase 5's CSV work. "Never hardcode card facts" honored structurally: engine + repo contain zero wallet facts; even the cheat-sheet's warehouse/foreign defaults are context, not cards.
- **Hand-checked arithmetic:** dining Alpha 5 × 1.2 = 6.0% ✔; groceries Alpha 4 × 1.2 = 4.8% vs Beta 3 × 1 = 3.0% ✔; foreign Beta 1.5 − 2.5 = −1.0% vs Gamma 2 − 0 = 2.0% ✔; capped Alpha falls to 1 × 1.2 = 1.2% ✔; verdict math: 10,000 + 6,000 − 15,000 = +1,000 KEEP / 10,000 + 4,000 − 15,000 = −1,000 DOWNGRADE ✔; Gamma 0 − 12,000 = −12,000 and never best in the default sheet (dining/groceries → Alpha, everything_else base 2% → Gamma **is** best there) — so the `cancel-candidates` unit test passes `isBestSomewhere: false` explicitly, and the E2E asserts DOWNGRADE only for Alpha. ✔ consistent.
- **Type consistency:** `CapUsage.periodKey` written by `addCapUsage` using the rate's own window ✔ matches picker reads; `RedeemedCredit.periodKey` from the credit's period ✔ matches `cardVerdict`; `importFile.cards` uses `cardImportEntry` whose `rewards` is `cardRewardsInput` = the engine's `CardRewards` shape ✔.
- **Known risks stated:** merchant acceptance facts change (UI hedges "verify at the till"); `pointValueCents` encodes redemption-style valuation (owner sets it per card in the private import — documented at the checkpoint); commit-authorship amendment (no trailers) supersedes earlier phases.
