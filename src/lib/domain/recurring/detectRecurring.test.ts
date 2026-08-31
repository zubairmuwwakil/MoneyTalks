import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sweepRecurringObligations } from "./detectRecurring";

type PurchaseRow = {
  id: string;
  userId: string;
  merchant: string;
  totalCents: number | null;
  currency: string | null;
  purchasedAt: Date;
};

type EmailRow = {
  id: string;
  userId: string;
  merchant: string;
  subject: string | null;
  purchasedAt: Date | null;
  createdAt: Date;
};

type EmailFactRow = {
  id: string;
  userId: string;
  emailTransactionId: string;
  type: "EXPLICIT_CADENCE" | "EXPLICIT_RECURRING" | "CANCELLATION" | "TRIAL_STARTED" | "TRIAL_ENDED" | "PRICE_CHANGE" | "NEXT_BILLING_DATE";
  occurredAt: Date;
  effectiveAt: Date | null;
  billingAt: Date | null;
  amountMinor: number | null;
  currency: string | null;
  cadence: string | null;
};

type ObligationRow = {
  id: string;
  userId: string;
  kind: string | null;
  merchantCanonicalId: string;
  currency: string | null;
  discriminator: string;
  seriesKey: string;
  cadence: unknown;
  schedule: unknown;
  amountPattern: "FIXED" | "VARIABLE" | "USAGE_BASED" | "UNKNOWN";
  status: "TRIALING" | "ACTIVE" | "CANCELLING" | "CANCELLED" | "LAPSED" | null;
  nextExpectedDate: Date | null;
  confidence: number;
  confidenceReasons: unknown;
  lastObservedAt: Date;
  algorithmVersion: number;
  origin: "DETECTED" | "EMAIL_STATED" | "USER" | "MIGRATED";
  needsReview: boolean;
  dismissedAt: Date | null;
  confirmedAt: Date | null;
  dismissReason: string | null;
  decidedConfidence: number | null;
  decidedReasons: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type EvidenceRow = {
  id: string;
  obligationId: string;
  purchaseId: string | null;
  emailTransactionId: string | null;
  emailFactId: string | null;
  role: "OCCURRENCE" | "CADENCE_FACT" | "CANCELLATION" | "TRIAL" | "PRICE_CHANGE";
  excludedByUser: boolean;
  occurredAt: Date;
};

type ObligationCreateData = Partial<ObligationRow>
  & Pick<ObligationRow, "userId" | "merchantCanonicalId" | "currency">;

type MemoryObligationDelegate = {
  findMany(args?: { where?: { userId?: string } }): Promise<Array<ObligationRow & { evidence: EvidenceRow[] }>>;
  findFirst(args: { where: { userId: string; merchantCanonicalId: string; currency: string | null; discriminator: string; seriesKey: string } }): Promise<ObligationRow | null>;
  count(): Promise<number>;
  create(args: { data: ObligationCreateData }): Promise<ObligationRow>;
  updateMany(args: {
    where: { id: string; origin?: { not: string } };
    data: Partial<ObligationRow>;
  }): Promise<{ count: number }>;
};

type MemoryEvidenceDelegate = {
  findMany(args?: { where?: { obligationId?: string } }): Promise<EvidenceRow[]>;
  count(args?: { where?: { obligationId?: string } }): Promise<number>;
  update(args: { where: { id: string }; data: Partial<EvidenceRow> }): Promise<EvidenceRow>;
  deleteMany(args: { where: { obligationId: string; excludedByUser: boolean } }): Promise<{ count: number }>;
  createMany(args: { data: Array<Omit<EvidenceRow, "id">> }): Promise<{ count: number }>;
};

class MemoryRecurringDb {
  purchases: PurchaseRow[] = [];
  emails: EmailRow[] = [];
  emailFacts: EmailFactRow[] = [];
  obligations: ObligationRow[] = [];
  evidence: EvidenceRow[] = [];
  private sequence = 0;

  private id(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  purchase: { findMany(args: { where: { userId: string } }): Promise<PurchaseRow[]> };
  emailTransaction: { findMany(args: { where: { userId: string } }): Promise<EmailRow[]> };
  emailObligationFact: { findMany(args: { where: { userId: string } }): Promise<Array<EmailFactRow & { emailTransaction: Pick<EmailRow, "id" | "merchant"> }>> };
  recurringObligation: MemoryObligationDelegate;
  recurringObligationEvidence: MemoryEvidenceDelegate;

  constructor() {
    this.purchase = { findMany: async ({ where }) => this.purchases.filter((row) => row.userId === where.userId) };
    this.emailTransaction = { findMany: async ({ where }) => this.emails.filter((row) => row.userId === where.userId) };
    this.emailObligationFact = {
      findMany: async ({ where }) => this.emailFacts
        .filter((row) => row.userId === where.userId)
        .map((row) => {
          const emailTransaction = this.emails.find((email) => email.id === row.emailTransactionId);
          if (!emailTransaction) throw new Error("email transaction not found");
          return { ...row, emailTransaction };
        }),
    };

    const findMany: MemoryObligationDelegate["findMany"] = async ({ where } = {}) =>
      this.obligations
        .filter((row) => !where?.userId || row.userId === where.userId)
        .map((row) => ({
          ...row,
          evidence: this.evidence.filter((candidate) => candidate.obligationId === row.id),
        }));
    const findFirst: MemoryObligationDelegate["findFirst"] = async ({ where }) =>
      this.obligations.find((row) =>
        row.userId === where.userId
        && row.merchantCanonicalId === where.merchantCanonicalId
        && row.currency === where.currency
        && row.discriminator === where.discriminator
        && row.seriesKey === where.seriesKey) ?? null;
    const create: MemoryObligationDelegate["create"] = async ({ data }) => {
      const now = new Date();
      const row = {
        id: this.id("obligation"),
        kind: null,
        discriminator: "",
        seriesKey: "",
        cadence: { type: "MONTHLY", dayOfMonth: 11 },
        schedule: [],
        amountPattern: "UNKNOWN" as const,
        status: null,
        nextExpectedDate: null,
        confidence: 0,
        confidenceReasons: [],
        lastObservedAt: now,
        algorithmVersion: 1,
        origin: "DETECTED" as const,
        needsReview: true,
        dismissedAt: null,
        confirmedAt: null,
        dismissReason: null,
        decidedConfidence: null,
        decidedReasons: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      } as ObligationRow;
      if (this.obligations.some((candidate) =>
        candidate.userId === row.userId
        && candidate.merchantCanonicalId === row.merchantCanonicalId
        && candidate.currency === row.currency
        && candidate.discriminator === row.discriminator
        && candidate.seriesKey === row.seriesKey)) {
        throw new Error("unique obligation identity");
      }
      this.obligations.push(row);
      return row;
    };
    const updateMany: MemoryObligationDelegate["updateMany"] = async ({ where, data }) => {
      const row = this.obligations.find((candidate) => candidate.id === where.id);
      if (!row || (where.origin?.not && row.origin === where.origin.not)) return { count: 0 };
      Object.assign(row, data, { updatedAt: new Date() });
      return { count: 1 };
    };
    this.recurringObligation = {
      findMany,
      findFirst,
      count: async () => this.obligations.length,
      create,
      updateMany,
    };

    const findEvidence: MemoryEvidenceDelegate["findMany"] = async ({ where } = {}) =>
      this.evidence.filter((row) => !where?.obligationId || row.obligationId === where.obligationId);
    const countEvidence: MemoryEvidenceDelegate["count"] = async ({ where } = {}) =>
      this.evidence.filter((row) => !where?.obligationId || row.obligationId === where.obligationId).length;
    const updateEvidence: MemoryEvidenceDelegate["update"] = async ({ where, data }) => {
      const row = this.evidence.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error("evidence not found");
      Object.assign(row, data);
      return row;
    };
    const deleteMany: MemoryEvidenceDelegate["deleteMany"] = async ({ where }) => {
      const before = this.evidence.length;
      this.evidence = this.evidence.filter((row) =>
        row.obligationId !== where.obligationId || row.excludedByUser !== where.excludedByUser);
      return { count: before - this.evidence.length };
    };
    const createMany: MemoryEvidenceDelegate["createMany"] = async ({ data }) => {
      this.evidence.push(...data.map((row) => ({ id: this.id("evidence"), ...row })));
      return { count: data.length };
    };
    this.recurringObligationEvidence = {
      findMany: findEvidence,
      count: countEvidence,
      update: updateEvidence,
      deleteMany,
      createMany,
    };
  }

  async $transaction<T>(operation: (tx: MemoryRecurringDb) => Promise<T>): Promise<T> {
    return operation(this);
  }
}

const sweepArgs = { userId: "user-1", timeZone: "America/Toronto", algorithmVersion: 1 };

function at(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

function seedPurchases(
  db: MemoryRecurringDb,
  merchant: string,
  dates: readonly string[],
  amounts: number | null | readonly (number | null)[],
  currency: string | null = "CAD",
): PurchaseRow[] {
  const values: readonly (number | null)[] = Array.isArray(amounts)
    ? amounts
    : dates.map(() => amounts);
  const rows = dates.map((date, index) => ({
    id: `${merchant}-purchase-${index}`,
    userId: "user-1",
    merchant,
    totalCents: values[index] ?? null,
    currency,
    purchasedAt: at(date),
  }));
  db.purchases.push(...rows);
  return rows;
}

function ownerObligation(merchant: string, confidence = 1): ObligationCreateData {
  return {
    userId: "user-1",
    merchantCanonicalId: merchant,
    currency: "CAD",
    discriminator: "",
    origin: "USER",
    confidence,
    cadence: { type: "ANNUAL", anchor: "2026-01-01" },
    schedule: [{ amountMinor: 1, from: "2026-01-01" }],
    amountPattern: "FIXED",
    status: "ACTIVE",
    lastObservedAt: at("2026-01-01"),
    confidenceReasons: [],
  };
}

describe("sweepRecurringObligations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at("2026-08-01"));
  });

  afterEach(() => vi.useRealTimers());

  it("creates an obligation from a regular purchase series", async () => {
    const db = new MemoryRecurringDb();
    seedPurchases(db, "netflix.com", ["2026-05-11", "2026-06-11", "2026-07-11"], 2_099);

    const result = await sweepRecurringObligations(db as unknown as PrismaClient, sweepArgs);

    expect(result).toMatchObject({ created: 1, updated: 0, unchanged: 0, skipped: 0 });
    expect(db.obligations).toHaveLength(1);
    expect(db.obligations[0]).toMatchObject({
      merchantCanonicalId: "netflix.com",
      status: "ACTIVE",
      needsReview: true,
    });
    expect(await db.recurringObligationEvidence.count({ where: { obligationId: db.obligations[0].id } })).toBe(3);
  });

  it("creates a review-only EMAIL_STATED obligation from cadence and next billing facts without charges", async () => {
    const db = new MemoryRecurringDb();
    db.emails.push({
      id: "email-renewal",
      userId: "user-1",
      merchant: "fictional-stream.example",
      subject: "Your plan renews monthly",
      purchasedAt: null,
      createdAt: at("2026-08-29"),
    });
    db.emailFacts.push(
      {
        id: "fact-cadence",
        userId: "user-1",
        emailTransactionId: "email-renewal",
        type: "EXPLICIT_CADENCE",
        occurredAt: at("2026-08-29"),
        effectiveAt: null,
        billingAt: null,
        amountMinor: null,
        currency: null,
        cadence: "MONTHLY",
      },
      {
        id: "fact-next-billing",
        userId: "user-1",
        emailTransactionId: "email-renewal",
        type: "NEXT_BILLING_DATE",
        occurredAt: at("2026-08-29"),
        effectiveAt: null,
        billingAt: at("2026-09-15"),
        amountMinor: null,
        currency: null,
        cadence: null,
      },
    );

    const result = await sweepRecurringObligations(db as unknown as PrismaClient, sweepArgs);

    expect(result).toMatchObject({ created: 1, updated: 0, unchanged: 0 });
    expect(db.obligations).toEqual([expect.objectContaining({
      merchantCanonicalId: "fictional-stream.example",
      currency: null,
      origin: "EMAIL_STATED",
      needsReview: true,
      confidence: 0.2,
      cadence: expect.objectContaining({ type: "MONTHLY", dayOfMonth: 15 }),
      nextExpectedDate: at("2026-09-15"),
    })]);
    expect(db.evidence).toHaveLength(2);
    expect(db.evidence.every(({ purchaseId, emailFactId }) => purchaseId === null && emailFactId !== null)).toBe(true);
  });

  it("is idempotent — a second sweep does not duplicate obligations or evidence", async () => {
    const db = new MemoryRecurringDb();
    seedPurchases(db, "netflix.com", ["2026-05-11", "2026-06-11", "2026-07-11"], 2_099);
    await sweepRecurringObligations(db as unknown as PrismaClient, sweepArgs);

    const second = await sweepRecurringObligations(db as unknown as PrismaClient, sweepArgs);

    expect(second).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(await db.recurringObligation.count()).toBe(1);
    expect(await db.recurringObligationEvidence.count()).toBe(3);
  });

  it("persists two series in one merchant/currency bucket without order-dependent loss", async () => {
    const db = new MemoryRecurringDb();
    const monthlyDates = ["2026-01-02", "2026-02-01", "2026-03-03", "2026-04-02", "2026-05-02", "2026-06-01"];
    db.purchases.push(
      ...monthlyDates.map((date, index) => ({
        id: `anthropic-plan-${index}`,
        userId: "user-1",
        merchant: "anthropic.com",
        totalCents: 2_000,
        currency: "USD",
        purchasedAt: at(date),
      })),
      ...monthlyDates.map((date, index) => ({
        id: `anthropic-usage-${index}`,
        userId: "user-1",
        merchant: "anthropic.com",
        totalCents: 500 + index * 700,
        currency: "USD",
        purchasedAt: new Date(at(date).getTime() + 10 * 86_400_000),
      })),
    );

    const first = await sweepRecurringObligations(db as unknown as PrismaClient, sweepArgs);
    db.purchases.push({
      id: "anthropic-plan-6",
      userId: "user-1",
      merchant: "anthropic.com",
      totalCents: 2_000,
      currency: "USD",
      purchasedAt: at("2026-07-01"),
    });
    db.purchases.reverse();
    const second = await sweepRecurringObligations(db as unknown as PrismaClient, sweepArgs);

    expect(first).toMatchObject({ created: 2, updated: 0, unchanged: 0 });
    expect(second).toMatchObject({ created: 0, updated: 1, unchanged: 1 });
    expect(db.obligations).toHaveLength(2);
    expect(new Set(db.obligations.map(({ cadence }) => JSON.stringify(cadence))).size).toBe(2);
    expect(new Set(db.obligations.map(({ seriesKey }) => seriesKey).filter(Boolean)).size).toBe(2);
    expect(db.evidence).toHaveLength(13);
  });

  it("preserves owner configuration while refreshing lifecycle evidence", async () => {
    const db = new MemoryRecurringDb();
    const owner = await db.recurringObligation.create({ data: ownerObligation("netflix.com") });
    seedPurchases(db, "netflix.com", ["2026-05-11", "2026-06-11", "2026-07-11"], 999);

    const result = await sweepRecurringObligations(db as unknown as PrismaClient, sweepArgs);

    expect(result.updated).toBe(1);
    expect(db.obligations).toEqual([owner]);
    expect(owner).toMatchObject({ origin: "USER", confidence: 1, cadence: { type: "ANNUAL" } });
  });

  it("preserves excluded evidence and does not re-attach its purchase", async () => {
    const db = new MemoryRecurringDb();
    const purchases = seedPurchases(
      db,
      "netflix.com",
      ["2026-04-11", "2026-05-11", "2026-06-11", "2026-07-11"],
      2_099,
    );
    await sweepRecurringObligations(db as unknown as PrismaClient, sweepArgs);
    const excluded = db.evidence.find((row) => row.purchaseId === purchases[2].id)!;
    await db.recurringObligationEvidence.update({ where: { id: excluded.id }, data: { excludedByUser: true } });

    await sweepRecurringObligations(db as unknown as PrismaClient, sweepArgs);

    const matching = db.evidence.filter((row) => row.purchaseId === purchases[2].id);
    expect(matching).toEqual([expect.objectContaining({ id: excluded.id, excludedByUser: true })]);
  });

  it("derives CANCELLED from an effective cancellation after the last charge", async () => {
    const db = new MemoryRecurringDb();
    seedPurchases(db, "23andme.com", ["2026-05-11", "2026-06-11", "2026-07-11"], 1_499);
    db.emails.push({
      id: "email-cancelled",
      userId: "user-1",
      merchant: "23andme.com",
      subject: "Your subscription canceled effective 2026-07-20",
      purchasedAt: at("2026-07-20"),
      createdAt: at("2026-07-20"),
    });
    db.emailFacts.push({
      id: "fact-cancelled-subject",
      userId: "user-1",
      emailTransactionId: "email-cancelled",
      type: "CANCELLATION",
      occurredAt: at("2026-07-20"),
      effectiveAt: at("2026-07-20"),
      billingAt: null,
      amountMinor: null,
      currency: null,
      cadence: null,
    });

    await sweepRecurringObligations(db as unknown as PrismaClient, sweepArgs);

    expect(db.obligations[0].status).toBe("CANCELLED");
    expect(db.obligations[0].confidence).toBeLessThan(0.5);
    expect(db.evidence).toContainEqual(expect.objectContaining({
      emailTransactionId: "email-cancelled",
      emailFactId: "fact-cancelled-subject",
      role: "CANCELLATION",
    }));
  });

  it("reads a body-derived persisted fact and links its payload-bearing row", async () => {
    const db = new MemoryRecurringDb();
    seedPurchases(db, "orbitstream.example", ["2026-05-11", "2026-06-11", "2026-07-11"], 1_499);
    db.emails.push({
      id: "email-body-only",
      userId: "user-1",
      merchant: "orbitstream.example",
      subject: "An update about your account",
      purchasedAt: null,
      createdAt: at("2026-07-20"),
    });
    db.emailFacts.push({
      id: "fact-cancelled",
      userId: "user-1",
      emailTransactionId: "email-body-only",
      type: "CANCELLATION",
      occurredAt: at("2026-07-20"),
      effectiveAt: at("2026-07-20"),
      billingAt: null,
      amountMinor: null,
      currency: null,
      cadence: null,
    });

    await sweepRecurringObligations(db as unknown as PrismaClient, sweepArgs);

    expect(db.obligations[0].status).toBe("CANCELLED");
    expect(db.evidence).toContainEqual(expect.objectContaining({
      emailTransactionId: "email-body-only",
      emailFactId: "fact-cancelled",
      role: "CANCELLATION",
    }));
  });

  it("honours an excluded fact without suppressing sibling facts from the email", async () => {
    const db = new MemoryRecurringDb();
    seedPurchases(db, "nebulapass.example", ["2026-05-11", "2026-06-11", "2026-07-11"], 999);
    db.emails.push({
      id: "email-multiple-facts",
      userId: "user-1",
      merchant: "nebulapass.example",
      subject: "An update about your account",
      purchasedAt: null,
      createdAt: at("2026-07-20"),
    });
    db.emailFacts.push(
      {
        id: "fact-cancellation-to-exclude",
        userId: "user-1",
        emailTransactionId: "email-multiple-facts",
        type: "CANCELLATION",
        occurredAt: at("2026-07-20"),
        effectiveAt: at("2026-07-20"),
        billingAt: null,
        amountMinor: null,
        currency: null,
        cadence: null,
      },
      {
        id: "fact-recurring-to-keep",
        userId: "user-1",
        emailTransactionId: "email-multiple-facts",
        type: "EXPLICIT_RECURRING",
        occurredAt: at("2026-07-20"),
        effectiveAt: null,
        billingAt: null,
        amountMinor: null,
        currency: null,
        cadence: null,
      },
    );
    await sweepRecurringObligations(db as unknown as PrismaClient, sweepArgs);
    const excluded = db.evidence.find((row) => row.emailFactId === "fact-cancellation-to-exclude")!;
    await db.recurringObligationEvidence.update({
      where: { id: excluded.id },
      data: { excludedByUser: true },
    });

    await sweepRecurringObligations(db as unknown as PrismaClient, sweepArgs);

    expect(db.obligations[0].status).toBe("ACTIVE");
    expect(db.evidence.filter((row) => row.emailFactId === "fact-cancellation-to-exclude"))
      .toEqual([expect.objectContaining({ id: excluded.id, excludedByUser: true })]);
    expect(db.evidence).toContainEqual(expect.objectContaining({
      emailFactId: "fact-recurring-to-keep",
      excludedByUser: false,
    }));
  });

  it("re-derives a row whose algorithmVersion is behind", async () => {
    const db = new MemoryRecurringDb();
    seedPurchases(db, "netflix.com", ["2026-05-11", "2026-06-11", "2026-07-11"], 2_099);
    await sweepRecurringObligations(db as unknown as PrismaClient, sweepArgs);

    const result = await sweepRecurringObligations(db as unknown as PrismaClient, { ...sweepArgs, algorithmVersion: 2 });

    expect(result.updated).toBe(1);
    expect(db.obligations[0].algorithmVersion).toBe(2);
  });

  it("never rewrites the score snapshot after an owner decides", async () => {
    const db = new MemoryRecurringDb();
    seedPurchases(db, "netflix.com", ["2026-05-11", "2026-06-11", "2026-07-11"], 2_099);
    await sweepRecurringObligations(db as unknown as PrismaClient, sweepArgs);
    const obligation = db.obligations[0];
    obligation.needsReview = false;
    obligation.confirmedAt = at("2026-08-01");
    obligation.decidedConfidence = obligation.confidence;
    obligation.decidedReasons = obligation.confidenceReasons;
    const decidedConfidence = obligation.decidedConfidence;
    const decidedReasons = obligation.decidedReasons;
    db.purchases.push(...["2026-02-11", "2026-03-11", "2026-04-11"].map((date, index) => ({
      id: `netflix-extra-${index}`,
      userId: "user-1",
      merchant: "netflix.com",
      totalCents: 2_099,
      currency: "CAD",
      purchasedAt: at(date),
    })));

    await sweepRecurringObligations(db as unknown as PrismaClient, { ...sweepArgs, algorithmVersion: 2 });

    expect(obligation.confidence).toBeGreaterThan(decidedConfidence!);
    expect(obligation.decidedConfidence).toBe(decidedConfidence);
    expect(obligation.decidedReasons).toEqual(decidedReasons);
  });

  it("skips currencyless purchases instead of inventing an identity", async () => {
    const db = new MemoryRecurringDb();
    seedPurchases(db, "cloudflare.com", ["2026-05-11", "2026-06-11", "2026-07-11"], 2_099, null);

    const result = await sweepRecurringObligations(db as unknown as PrismaClient, sweepArgs);

    expect(result.skipped).toBe(3);
    expect(db.obligations).toHaveLength(0);
  });

  it("uses null as the unique identity for an entirely unpriced series", async () => {
    const db = new MemoryRecurringDb();
    seedPurchases(db, "cloudflare.com", ["2026-05-11", "2026-06-11", "2026-07-11"], [null, null, null], null);

    await sweepRecurringObligations(db as unknown as PrismaClient, sweepArgs);
    const second = await sweepRecurringObligations(db as unknown as PrismaClient, sweepArgs);

    expect(db.obligations).toHaveLength(1);
    expect(db.obligations[0]).toMatchObject({ merchantCanonicalId: "cloudflare.com", currency: null, amountPattern: "UNKNOWN" });
    expect(second).toMatchObject({ unchanged: 1 });
  });

  it("persists the lifecycle grace band as an honest null status", async () => {
    vi.setSystemTime(at("2026-08-29"));
    const db = new MemoryRecurringDb();
    seedPurchases(db, "netflix.com", ["2026-05-11", "2026-06-11", "2026-07-11"], 2_099);

    await sweepRecurringObligations(db as unknown as PrismaClient, sweepArgs);

    expect(db.obligations[0].status).toBeNull();
  });

  it("matches the 57-purchase ground-truth shape with exactly two obligations", async () => {
    const db = new MemoryRecurringDb();
    const months = Array.from({ length: 33 }, (_, index) => {
      const date = new Date(Date.UTC(2023, 11 + index, 11, 12));
      return date.toISOString().slice(0, 10);
    });
    seedPurchases(db, "anthropic.com", months.slice(0, 18), months.slice(0, 18).map((_, index) => index % 3 === 0 ? 500 : 3_000));
    seedPurchases(db, "heroku.com", months.slice(18), months.slice(18).map((_, index) => index % 2 === 0 ? 700 : 4_000));
    for (let index = 0; index < 24; index += 1) {
      seedPurchases(db, `noise-${index}.example`, [`2026-07-${String((index % 24) + 1).padStart(2, "0")}`], 100 + index);
    }
    expect(db.purchases).toHaveLength(57);
    expect(new Set(db.purchases.map(({ merchant }) => merchant)).size).toBe(26);

    await sweepRecurringObligations(db as unknown as PrismaClient, sweepArgs);

    expect(db.obligations.map(({ merchantCanonicalId, cadence, amountPattern }) => ({ merchantCanonicalId, cadence, amountPattern })))
      .toEqual([
        { merchantCanonicalId: "anthropic.com", cadence: expect.objectContaining({ type: "MONTHLY" }), amountPattern: "USAGE_BASED" },
        { merchantCanonicalId: "heroku.com", cadence: expect.objectContaining({ type: "MONTHLY" }), amountPattern: "USAGE_BASED" },
      ]);
  });
});
