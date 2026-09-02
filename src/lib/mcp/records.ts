import "server-only";
import { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cadenceType, currentAmountMinor, obligationName } from "@/lib/domain/recurring/readModel";
import { cadenceInput } from "@/lib/validation/bills";
import { amountOn, occurrencesBetween } from "@/engine/recurrence";

export const recordKinds = ["purchase", "subscription", "return", "bill"] as const;
export type RecordKind = typeof recordKinds[number];
export const listInput = z.object({
  kind: z.enum(recordKinds),
  query: z.string().trim().max(200).default(""),
  cursor: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
  limit: z.number().int().min(1).max(50).default(25),
});
export const spendingInput = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  merchant: z.string().trim().max(200).optional(),
  category: z.string().trim().max(100).optional(),
}).refine(input => input.from <= input.to, "from must be on or before to");

const safeSchedule = z.array(z.object({ from: z.iso.date(), to: z.iso.date().optional(), amountMinor: z.number().int() }));

// Explicit projections are the boundary: no email bodies, credentials, payment
// identifiers, attachment URLs, precise location, or raw ingestion payloads.
const purchaseSelect = {
  id: true, merchant: true, totalCents: true, currency: true, purchasedAt: true,
  category: true, source: true, financialState: true, possibleDuplicateOfId: true,
  updatedAt: true,
} satisfies Prisma.PurchaseSelect;
const subscriptionSelect = {
  id: true, displayName: true, merchantCanonicalId: true, currency: true, cadence: true,
  schedule: true, status: true, nextExpectedDate: true, confidence: true,
  needsReview: true, dismissedAt: true, lastObservedAt: true, updatedAt: true,
} satisfies Prisma.RecurringObligationSelect;
const returnSelect = {
  id: true, store: true, amountCents: true, currency: true, purchaseDate: true,
  returnBy: true, status: true, deliveredAt: true, refundExpectedAt: true,
  refundedDate: true, refundAmountCents: true, refundSlaDays: true, updatedAt: true,
} satisfies Prisma.ReturnItemSelect;
const billSelect = {
  id: true, name: true, category: true, currency: true, autopay: true, variable: true,
  cadence: true, schedule: true, updatedAt: true,
} satisfies Prisma.BillSelect;

export type AgentRecord = { id: string; title: string; url: string; data: Record<string, unknown> };
function record(kind: RecordKind, id: string, title: string, data: Record<string, unknown>, origin: string): AgentRecord {
  const path = kind === "purchase" ? `/purchases/${encodeURIComponent(id)}` : kind === "return" ? `/returns/${encodeURIComponent(id)}` : kind === "bill" ? `/bills/${encodeURIComponent(id)}` : "/subscriptions";
  return { id: `${kind}:${id}`, title, url: `${origin}${path}`, data };
}
function purchaseRecord(row: Prisma.PurchaseGetPayload<{ select: typeof purchaseSelect }>, origin: string) {
  const { id, possibleDuplicateOfId, ...data } = row;
  return record("purchase", id, `${row.merchant} · ${row.purchasedAt.toISOString().slice(0, 10)}`, { ...data, possibleDuplicate: possibleDuplicateOfId !== null }, origin);
}
function subscriptionRecord(row: Prisma.RecurringObligationGetPayload<{ select: typeof subscriptionSelect }>, origin: string) {
  return record("subscription", row.id, obligationName(row), {
    currency: row.currency, amountMinor: currentAmountMinor(row.schedule),
    cadence: cadenceType(row.cadence), status: row.status, nextExpectedDate: row.nextExpectedDate,
    confidence: row.confidence, needsReview: row.needsReview, dismissed: row.dismissedAt !== null,
    lastObservedAt: row.lastObservedAt, updatedAt: row.updatedAt,
    // Only expected amount history, not free-form JSON or owner notes.
    amountHistory: Array.isArray(row.schedule) ? row.schedule.flatMap(value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      return typeof value.from === "string" && typeof value.amountMinor === "number"
        ? [{ from: value.from, amountMinor: value.amountMinor }] : [];
    }) : [],
  }, origin);
}
function returnRecord(row: Prisma.ReturnItemGetPayload<{ select: typeof returnSelect }>, origin: string) {
  const { id, ...data } = row;
  return record("return", id, `${row.store} return`, data, origin);
}
function billRecord(row: Prisma.BillGetPayload<{ select: typeof billSelect }>, origin: string) {
  return record("bill", row.id, row.name, {
    category: row.category, currency: row.currency, autopay: row.autopay,
    variable: row.variable, cadence: cadenceInput.safeParse(row.cadence).data ?? null,
    schedule: safeSchedule.safeParse(row.schedule).data ?? null,
    latestScheduledAmountMinor: currentAmountMinor(row.schedule),
    updatedAt: row.updatedAt,
  }, origin);
}

export async function listRecords(userId: string, input: z.infer<typeof listInput>, origin: string) {
  const { kind, query, cursor, limit } = input;
  const base = { userId, ...(cursor ? { id: { lt: cursor } } : {}) };
  const text = { contains: query, mode: "insensitive" as const };
  const paging = { take: limit + 1, orderBy: { id: "desc" as const } };
  let rows: AgentRecord[];
  if (kind === "purchase") {
    rows = (await prisma.purchase.findMany({ where: { ...base, ...(query ? { OR: [{ merchant: text }, { category: text }, { items: { some: { title: text } } }] } : {}) }, select: purchaseSelect, ...paging })).map(row => purchaseRecord(row, origin));
  } else if (kind === "subscription") {
    rows = (await prisma.recurringObligation.findMany({ where: { ...base, ...(query ? { OR: [{ displayName: text }, { merchantCanonicalId: text }] } : {}) }, select: subscriptionSelect, ...paging })).map(row => subscriptionRecord(row, origin));
  } else if (kind === "return") {
    rows = (await prisma.returnItem.findMany({ where: { ...base, ...(query ? { store: text } : {}) }, select: returnSelect, ...paging })).map(row => returnRecord(row, origin));
  } else {
    rows = (await prisma.bill.findMany({ where: { ...base, ...(query ? { OR: [{ name: text }, { category: text }] } : {}) }, select: billSelect, ...paging })).map(row => billRecord(row, origin));
  }
  const hasMore = rows.length > limit;
  const records = rows.slice(0, limit);
  return { records, nextCursor: hasMore ? records.at(-1)!.id.split(":")[1] : null };
}

export async function searchRecords(userId: string, query: string, origin: string) {
  const pages = await Promise.all(recordKinds.map(kind => listRecords(userId, { kind, query, limit: 20 }, origin)));
  return { results: pages.flatMap(page => page.records.map(({ id, title, url }) => ({ id, title, url }))) };
}

export async function fetchRecord(userId: string, reference: string, origin: string) {
  const [kind, id] = reference.split(":");
  const where = { id, userId };
  let result: AgentRecord | null = null;
  if (kind === "purchase") {
    const row = await prisma.purchase.findFirst({ where, select: purchaseSelect });
    if (row) {
      result = purchaseRecord(row, origin);
      const items = await prisma.purchaseItem.findMany({
        where: { purchaseId: id, purchase: { userId } },
        select: { title: true, qty: true, priceCents: true, currency: true },
        orderBy: { id: "asc" }, take: 101,
      });
      result.data.items = items.slice(0, 100);
      result.data.itemsTruncated = items.length > 100;
    }
  } else if (kind === "subscription") {
    const row = await prisma.recurringObligation.findFirst({ where, select: subscriptionSelect });
    if (row) result = subscriptionRecord(row, origin);
  } else if (kind === "return") {
    const row = await prisma.returnItem.findFirst({ where, select: returnSelect });
    if (row) result = returnRecord(row, origin);
  } else if (kind === "bill") {
    const row = await prisma.bill.findFirst({ where, select: billSelect });
    if (row) result = billRecord(row, origin);
  }
  if (!result) return null;
  return { id: result.id, title: result.title, text: JSON.stringify(result.data), url: result.url };
}

export async function accountTimezone(userId: string) {
  const preference = await prisma.notificationPreference.findUnique({ where: { userId }, select: { timezone: true } });
  return preference?.timezone || "UTC";
}

export function spendingWindow(from: string, to: string, timezone: string) {
  const start = DateTime.fromISO(from, { zone: timezone }).startOf("day");
  const end = DateTime.fromISO(to, { zone: timezone }).plus({ days: 1 }).startOf("day");
  if (!start.isValid || !end.isValid || end <= start || end.diff(start, "days").days > 3660) {
    throw new Error("Choose an ordered date range of at most ten years.");
  }
  return { gte: start.toJSDate(), lt: end.toJSDate() };
}

export async function spendingSummary(userId: string, input: z.infer<typeof spendingInput>) {
  const timezone = await accountTimezone(userId);
  const where: Prisma.PurchaseWhereInput = {
    userId, purchasedAt: spendingWindow(input.from, input.to, timezone),
    financialState: { notIn: ["DECLINED", "REVERSED"] },
    ...(input.merchant ? { merchant: { contains: input.merchant, mode: "insensitive" } } : {}),
    ...(input.category ? { category: { equals: input.category, mode: "insensitive" } } : {}),
  };
  const groupQuery = prisma.purchase.groupBy({ by: ["currency", "category"], orderBy: [{ currency: "asc" }, { category: "asc" }], where, _sum: { totalCents: true }, _count: { _all: true, totalCents: true } });
  const [groups, possibleDuplicates] = await prisma.$transaction([
    groupQuery,
    prisma.purchase.count({ where: { ...where, possibleDuplicateOfId: { not: null } } }),
  ], { isolationLevel: "RepeatableRead" });
  return {
    from: input.from, to: input.to, timezone, allMatchingRecordsAggregated: true,
    groups: groups.map(group => ({
      currency: group.currency, category: group.category, amountMinor: group._sum.totalCents,
      recordCount: group._count._all, unknownAmountCount: group._count._all - group._count.totalCents,
    })),
    possibleDuplicateCount: possibleDuplicates,
    coverage: "Recorded purchases only; declined and reversed purchases excluded. Possible duplicates remain included and may overstate totals. Unknown currency is not converted or combined with known currencies. Refunds are tracked separately; this is gross recorded spending, not net cash flow.",
  };
}

export async function attentionSummary(userId: string, origin: string, now = new Date()) {
  const timezone = await accountTimezone(userId);
  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf("day");
  const end = today.plus({ days: 7 }).toJSDate();
  const start = today.toJSDate();
  const renewalWhere: Prisma.RecurringObligationWhereInput = {
    userId, dismissedAt: null, status: { in: ["ACTIVE", "TRIALING", "CANCELLING"] },
    nextExpectedDate: { gte: start, lt: end },
  };
  const returnWhere: Prisma.ReturnItemWhereInput = {
    userId, status: { in: ["NOT_STARTED", "PACKED"] }, returnBy: { gte: start, lt: end },
  };
  // Refund eligibility includes delivery-derived estimates; the server evaluates
  // the entire candidate set before limiting output so older cases aren't lost.
  const [renewals, renewalCount, returns, returnCount, refundCandidates, bills] = await Promise.all([
    prisma.recurringObligation.findMany({ where: renewalWhere, select: subscriptionSelect, orderBy: [{ nextExpectedDate: "asc" }, { id: "asc" }], take: 50 }),
    prisma.recurringObligation.count({ where: renewalWhere }),
    prisma.returnItem.findMany({ where: returnWhere, select: returnSelect, orderBy: [{ returnBy: "asc" }, { id: "asc" }], take: 50 }),
    prisma.returnItem.count({ where: returnWhere }),
    prisma.returnItem.findMany({ where: { userId, status: { in: ["DROPPED_OFF", "DELIVERED"] }, OR: [{ refundExpectedAt: { lt: now } }, { refundExpectedAt: null, deliveredAt: { lt: now } }] }, select: returnSelect, orderBy: { id: "asc" } }),
    prisma.bill.findMany({ where: { userId }, select: billSelect, orderBy: { id: "asc" } }),
  ]);
  const overdue = refundCandidates.flatMap(row => {
    const expected = row.refundExpectedAt ?? (row.deliveredAt ? DateTime.fromJSDate(row.deliveredAt, { zone: timezone }).plus({ days: row.refundSlaDays }).toJSDate() : null);
    return expected && expected < now ? [{ ...returnRecord(row, origin), expectedAt: expected, expectedDateEstimated: row.refundExpectedAt === null }] : [];
  });
  const unrecognizedBillSchedules: string[] = [];
  const scheduledBills = bills.flatMap(row => {
    const cadence = cadenceInput.safeParse(row.cadence);
    const schedule = safeSchedule.safeParse(row.schedule);
    if (!cadence.success || !schedule.success) { unrecognizedBillSchedules.push(`bill:${row.id}`); return []; }
    return occurrencesBetween(cadence.data, today.toISODate()!, today.plus({ days: 6 }).toISODate()!).map(date => ({
      ...billRecord(row, origin), scheduledDate: date, amountMinor: amountOn(schedule.data, date),
      amountEstimated: row.variable, paymentStatus: "not_checked",
    }));
  }).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.id.localeCompare(b.id));
  return {
    asOf: now.toISOString(), timezone, from: start.toISOString(), toExclusive: end.toISOString(),
    renewals: { total: renewalCount, records: renewals.map(row => subscriptionRecord(row, origin)), truncated: renewalCount > 50 },
    returnDeadlines: { total: returnCount, records: returns.map(row => returnRecord(row, origin)), truncated: returnCount > 50 },
    overdueRefunds: { total: overdue.length, records: overdue.slice(0, 50), truncated: overdue.length > 50 },
    scheduledBills: { total: scheduledBills.length, records: scheduledBills.slice(0, 50), truncated: scheduledBills.length > 50, unrecognizedSchedules: unrecognizedBillSchedules },
    coverage: "Seven calendar days including today. Expected renewals can be estimates; needsReview and confidence describe detection uncertainty. Scheduled bills may already be paid. Bills and recurring obligations may overlap; do not add them together as a cash-flow total. Use list_records to inspect more records.",
  };
}
