import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  purchase: { findMany: vi.fn(), findFirst: vi.fn(), groupBy: vi.fn(), count: vi.fn() },
  purchaseItem: { findMany: vi.fn() },
  recurringObligation: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  returnItem: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  bill: { findMany: vi.fn(), findFirst: vi.fn() },
  notificationPreference: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { attentionSummary, fetchRecord, listRecords, recordKinds, searchRecords, spendingSummary, spendingWindow } from "./records";

const origin = "https://inunity.ca";
function purchase(id: string) {
  return { id, merchant: "Cafe", totalCents: 500, currency: "CAD", purchasedAt: new Date("2026-09-01"), category: "dining", source: "GMAIL", financialState: "NORMALIZED", possibleDuplicateOfId: null, updatedAt: new Date("2026-09-01") };
}
beforeEach(() => {
  vi.resetAllMocks();
  for (const model of [db.purchase, db.recurringObligation, db.returnItem, db.bill]) {
    model.findMany.mockResolvedValue([]);
    model.findFirst.mockResolvedValue(null);
  }
  db.purchaseItem.findMany.mockResolvedValue([]);
  db.purchase.count.mockResolvedValue(0);
  db.recurringObligation.count.mockResolvedValue(0);
  db.returnItem.count.mockResolvedValue(0);
  db.notificationPreference.findUnique.mockResolvedValue({ timezone: "America/Toronto" });
  db.$transaction.mockImplementation(values => Promise.all(values));
});

describe("record access and minimization", () => {
  it("scopes every search branch to the verified owner and uses explicit projections", async () => {
    await searchRecords("owner-a", "coffee", origin);
    for (const model of [db.purchase, db.recurringObligation, db.returnItem, db.bill]) {
      const args = model.findMany.mock.calls[0][0];
      expect(args.where.userId).toBe("owner-a");
      expect(args.select).toBeDefined();
      for (const privateField of ["accountNumber", "accountNumberEncrypted", "loginIdentifier", "notes", "rawPayload", "attachments", "sourceEmailId"]) expect(args.select[privateField]).toBeUndefined();
    }
  });
  it.each(recordKinds)("a foreign %s id cannot be fetched", async kind => {
    expect(await fetchRecord("owner-a", `${kind}:belongs-to-b`, origin)).toBeNull();
    const model = kind === "purchase" ? db.purchase : kind === "subscription" ? db.recurringObligation : kind === "return" ? db.returnItem : db.bill;
    expect(model.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "belongs-to-b", userId: "owner-a" } }));
  });
  it("supports stable pagination without resolving an untrusted cursor as a record", async () => {
    db.purchase.findMany.mockResolvedValue([purchase("c3"), purchase("c2"), purchase("c1")]);
    const first = await listRecords("owner-a", { kind: "purchase", query: "", limit: 2 }, origin);
    expect(first.records.map(row => row.id)).toEqual(["purchase:c3", "purchase:c2"]);
    expect(first.nextCursor).toBe("c2");
    db.purchase.findMany.mockResolvedValue([purchase("c1")]);
    const last = await listRecords("owner-a", { kind: "purchase", query: "", limit: 2, cursor: first.nextCursor! }, origin);
    expect(last.nextCursor).toBeNull();
    expect(db.purchase.findMany.mock.lastCall?.[0].where).toEqual({ userId: "owner-a", id: { lt: "c2" } });
  });
  it("fetches safe receipt line items under the same ownership boundary", async () => {
    db.purchase.findFirst.mockResolvedValue(purchase("p1"));
    db.purchaseItem.findMany.mockResolvedValue([{ title: "Headphones", qty: 1, priceCents: 500, currency: "CAD" }]);
    const record = await fetchRecord("owner-a", "purchase:p1", origin);
    expect(JSON.parse(record!.text).items[0].title).toBe("Headphones");
    expect(db.purchaseItem.findMany.mock.lastCall?.[0].where).toEqual({ purchaseId: "p1", purchase: { userId: "owner-a" } });
    expect(record?.url).toBe("https://inunity.ca/purchases/p1");
  });
  it("does not expose arbitrary schedule metadata or bill identifiers", async () => {
    db.bill.findFirst.mockResolvedValue({ id: "b1", name: "Utilities", currency: "CAD", category: "utilities", autopay: false, variable: true,
      cadence: { type: "MONTHLY", dayOfMonth: 2, secret: "hidden" }, schedule: [{ from: "2026-01-01", amountMinor: 10000, note: "private note", secret: "hidden" }], accountNumber: "private number", updatedAt: new Date() });
    const result = await fetchRecord("owner-a", "bill:b1", origin);
    expect(result?.text).not.toMatch(/hidden|private note|private number/);
  });
});

describe("complete spending aggregation", () => {
  it("uses user-local date boundaries across daylight savings", () => {
    const window = spendingWindow("2026-03-08", "2026-03-08", "America/Toronto");
    expect(window.gte.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(window.lt.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });
  it("rejects inverted or invalid windows", () => {
    expect(() => spendingWindow("2026-09-02", "2026-09-01", "America/Toronto")).toThrow();
    expect(() => spendingWindow("2026-09-01", "2026-09-02", "invalid-zone")).toThrow();
  });
  it("aggregates every matching row, preserves currencies and reports incomplete amounts", async () => {
    db.purchase.groupBy.mockResolvedValue([
      { currency: "CAD", category: "dining", _sum: { totalCents: 9000 }, _count: { _all: 300, totalCents: 299 } },
      { currency: "USD", category: "dining", _sum: { totalCents: 500 }, _count: { _all: 1, totalCents: 1 } },
      { currency: null, category: null, _sum: { totalCents: null }, _count: { _all: 2, totalCents: 0 } },
    ]);
    db.purchase.count.mockResolvedValue(2);
    const result = await spendingSummary("owner-a", { from: "2026-09-01", to: "2026-09-02" });
    expect(result.groups.map(group => [group.currency, group.amountMinor, group.unknownAmountCount])).toEqual([["CAD", 9000, 1], ["USD", 500, 0], [null, null, 2]]);
    expect(result.possibleDuplicateCount).toBe(2);
    expect(db.purchase.groupBy.mock.calls[0][0]).toMatchObject({ where: { userId: "owner-a", financialState: { notIn: ["DECLINED", "REVERSED"] } } });
    expect(db.purchase.groupBy.mock.calls[0][0].take).toBeUndefined();
    expect(db.purchase.findMany).not.toHaveBeenCalled();
  });
});

describe("weekly attention", () => {
  it("reports empty data and counts rather than inventing a financial total", async () => {
    const summary = await attentionSummary("owner-a", origin, new Date("2026-09-02T02:00:00Z"));
    expect(summary.from).toBe("2026-09-01T04:00:00.000Z");
    expect(summary.toExclusive).toBe("2026-09-08T04:00:00.000Z");
    expect(summary.renewals.total).toBe(0);
    expect(summary.scheduledBills.total).toBe(0);
    expect(summary.overdueRefunds.total).toBe(0);
  });
  it("includes delivery-derived overdue refunds and distinguishes estimated dates", async () => {
    db.returnItem.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: "r1", store: "Shop", status: "DELIVERED", deliveredAt: new Date("2026-08-01"), refundSlaDays: 14, refundExpectedAt: null },
      { id: "r2", store: "Shop", status: "DELIVERED", deliveredAt: new Date("2026-09-01"), refundSlaDays: 14, refundExpectedAt: null },
    ]);
    const summary = await attentionSummary("owner-a", origin, new Date("2026-09-02T12:00:00Z"));
    expect(summary.overdueRefunds.total).toBe(1);
    expect(summary.overdueRefunds.records[0].expectedDateEstimated).toBe(true);
  });
  it("includes scheduled bills even when their amount is unknown, and labels payment uncertainty", async () => {
    db.bill.findMany.mockResolvedValue([{ id: "b1", name: "Utilities", currency: "CAD", category: "utilities", autopay: true, variable: true,
      cadence: { type: "MONTHLY", dayOfMonth: 3 }, schedule: [], updatedAt: new Date() }]);
    const summary = await attentionSummary("owner-a", origin, new Date("2026-09-02T12:00:00Z"));
    expect(summary.scheduledBills.records[0]).toMatchObject({ scheduledDate: "2026-09-03", amountMinor: null, amountEstimated: true, paymentStatus: "not_checked" });
  });
});
