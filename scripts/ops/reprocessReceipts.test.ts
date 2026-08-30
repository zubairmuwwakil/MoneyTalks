import { describe, expect, it } from "vitest";

import {
  buildReprocessReport,
  formatReprocessReport,
  type ReprocessSnapshot,
} from "./reprocessReceipts";

function purchase(
  id: string,
  merchant: string,
  overrides: Partial<ReprocessSnapshot["purchases"][number]> = {},
): ReprocessSnapshot["purchases"][number] {
  return {
    id,
    userId: "user-1",
    merchant,
    totalCents: 6777,
    currency: "CAD",
    currencySource: "explicitCode",
    purchasedAt: new Date("2026-07-15T09:49:14.000Z"),
    orderNumber: "0000097381261",
    paymentMethod: null,
    source: "GMAIL",
    sourceEmailId: `message-${id}`,
    sourceEventId: null,
    category: null,
    categorySource: null,
    possibleDuplicateOfId: null,
    financialState: "NORMALIZED",
    items: [],
    ...overrides,
  };
}

describe("reprocess receipt dry-run reporting", () => {
  it("groups deletions, re-links, and field updates with before/after counts", () => {
    const simons1 = purchase("simons-1", "simons.ca");
    const simons2 = purchase("simons-2", "simons.ca");
    const simons3 = purchase("simons-3", "simons.ca");
    const vercelBefore = purchase("vercel-1", "vercel.com", {
      totalCents: 2260,
      currency: null,
      currencySource: null,
      orderNumber: "3641-7748",
    });
    const vercelAfter = { ...vercelBefore, currency: "USD", currencySource: "merchantDefault" };
    const before: ReprocessSnapshot = {
      totalPurchases: 57,
      purchases: [simons1, simons2, simons3, vercelBefore],
      emailLinks: [
        { id: "email-s1", messageId: "message-s1", merchant: "simons.ca", purchaseId: simons1.id },
        { id: "email-s2", messageId: "message-s2", merchant: "simons.ca", purchaseId: simons2.id },
        { id: "email-s3", messageId: "message-s3", merchant: "simons.ca", purchaseId: simons3.id },
        { id: "email-v1", messageId: "message-v1", merchant: "vercel.com", purchaseId: vercelBefore.id },
      ],
    };
    const after: ReprocessSnapshot = {
      totalPurchases: 55,
      purchases: [simons1, vercelAfter],
      emailLinks: [
        { id: "email-s1", messageId: "message-s1", merchant: "simons.ca", purchaseId: simons1.id },
        { id: "email-s2", messageId: "message-s2", merchant: "simons.ca", purchaseId: simons1.id },
        { id: "email-s3", messageId: "message-s3", merchant: "simons.ca", purchaseId: simons1.id },
        { id: "email-v1", messageId: "message-v1", merchant: "vercel.com", purchaseId: vercelBefore.id },
      ],
    };

    const report = buildReprocessReport(before, after);

    expect(report).toMatchObject({ beforeTotal: 57, afterTotal: 55 });
    expect(report.merchants).toHaveLength(2);
    expect(report.merchants[0]).toMatchObject({
      merchant: "simons.ca",
      beforeCount: 3,
      afterCount: 1,
      deleted: [{ id: "simons-2" }, { id: "simons-3" }],
      relinked: [
        { messageId: "message-s2", fromPurchaseId: "simons-2", toPurchaseId: "simons-1" },
        { messageId: "message-s3", fromPurchaseId: "simons-3", toPurchaseId: "simons-1" },
      ],
    });
    expect(report.merchants[1]).toMatchObject({
      merchant: "vercel.com",
      beforeCount: 1,
      afterCount: 1,
      updated: [{ id: "vercel-1", fields: ["currency", "currencySource"] }],
    });

    const output = formatReprocessReport(report);
    expect(output).toContain("Purchase total: 57 -> 55 (-2).");
    expect(output).toContain("simons.ca: 3 -> 1");
    expect(output.match(/  DELETE  /g)).toHaveLength(2);
    expect(output.match(/  MERGE\/RE-LINK  /g)).toHaveLength(2);
    expect(output).toContain("vercel.com: 1 -> 1");
    expect(output).toContain("currency null -> \"USD\"");
  });

  it("makes a zero-change preview unambiguous", () => {
    const row = purchase("unchanged", "example.com");
    const snapshot: ReprocessSnapshot = {
      totalPurchases: 1,
      purchases: [row],
      emailLinks: [{
        id: "email-1",
        messageId: "message-1",
        merchant: "example.com",
        purchaseId: row.id,
      }],
    };

    expect(formatReprocessReport(buildReprocessReport(snapshot, snapshot))).toBe(
      "Purchase total: 1 -> 1 (+0).\nNo purchase rows or purchase links would change.",
    );
  });
});
