import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { bulkUpdateCardRenewalDates } from "./actions";

vi.mock("@/lib/require-user", () => ({ requireUserId: vi.fn(async () => "user-1") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    creditCard: { updateMany: vi.fn(), findFirst: vi.fn() },
  },
}));

describe("bulkUpdateCardRenewalDates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("successfully updates valid month-day and grace periods", async () => {
    vi.mocked(prisma.creditCard.updateMany).mockResolvedValue({ count: 1 });

    const result = await bulkUpdateCardRenewalDates([
      { cardId: "card-1", feeMonthDay: "08-15", feeCancelGraceDays: 30 },
      { cardId: "card-2", feeMonthDay: "12-01", feeCancelGraceDays: 45 },
    ]);

    expect(result.ok).toBe(true);
    expect(prisma.creditCard.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.creditCard.updateMany).toHaveBeenCalledWith({
      where: { id: "card-1", userId: "user-1" },
      data: { feeMonthDay: "08-15", feeCancelGraceDays: 30 },
    });
    expect(prisma.creditCard.updateMany).toHaveBeenCalledWith({
      where: { id: "card-2", userId: "user-1" },
      data: { feeMonthDay: "12-01", feeCancelGraceDays: 45 },
    });
  });

  it("skips invalid month-day formats", async () => {
    vi.mocked(prisma.creditCard.updateMany).mockResolvedValue({ count: 1 });

    const result = await bulkUpdateCardRenewalDates([
      { cardId: "card-1", feeMonthDay: "invalid", feeCancelGraceDays: 30 },
      { cardId: "card-2", feeMonthDay: "13-45", feeCancelGraceDays: 30 },
      { cardId: "card-3", feeMonthDay: "05-10", feeCancelGraceDays: 30 },
    ]);

    expect(result.ok).toBe(true);
    expect(prisma.creditCard.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.creditCard.updateMany).toHaveBeenCalledWith({
      where: { id: "card-3", userId: "user-1" },
      data: { feeMonthDay: "05-10", feeCancelGraceDays: 30 },
    });
  });

  it("returns error for empty list", async () => {
    const result = await bulkUpdateCardRenewalDates([]);
    expect(result.ok).toBe(false);
  });
});
