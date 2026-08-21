import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { bulkUpdateCardRenewalDates, createCard } from "./actions";

vi.mock("@/lib/require-user", () => ({ requireUserId: vi.fn(async () => "user-1") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    creditCard: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
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

describe("createCard nickname derivation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.creditCard.create).mockResolvedValue({ id: "card-new" } as never);
  });

  function formData(nickname = "Amex Cobalt") {
    const fd = new FormData();
    fd.set(
      "cardJson",
      JSON.stringify({
        nickname,
        issuer: "American Express",
        network: "AMEX",
        contractCardId: "amex-cobalt",
      }),
    );
    return fd;
  }

  /** createCard redirects on success, and redirect() throws by design. */
  async function run(fd: FormData) {
    try {
      return { state: await createCard({}, fd), redirected: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("NEXT_REDIRECT:")) return { state: null, redirected: true };
      throw error;
    }
  }

  function savedNickname(): string {
    const call = vi.mocked(prisma.creditCard.create).mock.calls[0]?.[0] as
      | { data: { nickname: string } }
      | undefined;
    return call?.data.nickname ?? "";
  }

  it("uses the catalogue name when the owner has no card by that name", async () => {
    vi.mocked(prisma.creditCard.findMany).mockResolvedValue([] as never);

    const result = await run(formData());

    expect(result.redirected).toBe(true);
    expect(savedNickname()).toBe("Amex Cobalt");
  });

  it("adds a second copy of a card the owner already holds", async () => {
    vi.mocked(prisma.creditCard.findMany).mockResolvedValue([{ nickname: "Amex Cobalt" }] as never);

    const result = await run(formData());

    expect(result.redirected).toBe(true);
    expect(savedNickname()).toBe("Amex Cobalt (2)");
  });

  it("keeps counting past the second copy", async () => {
    vi.mocked(prisma.creditCard.findMany).mockResolvedValue([
      { nickname: "Amex Cobalt" },
      { nickname: "Amex Cobalt (2)" },
    ] as never);

    const result = await run(formData());

    expect(result.redirected).toBe(true);
    expect(savedNickname()).toBe("Amex Cobalt (3)");
  });

  it("does not mistake a longer card name for a copy", async () => {
    vi.mocked(prisma.creditCard.findMany).mockResolvedValue([
      { nickname: "Amex Cobalt Gold" },
    ] as never);

    const result = await run(formData());

    expect(result.redirected).toBe(true);
    expect(savedNickname()).toBe("Amex Cobalt");
  });

  it("reports a visible error when the write loses a race, never a hidden field error", async () => {
    vi.mocked(prisma.creditCard.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.creditCard.create).mockRejectedValue({ code: "P2002" } as never);

    const result = await run(formData());

    expect(result.redirected).toBe(false);
    // Create mode renders no nickname input, so an error parked only on that
    // field would be invisible: the owner would tap Add and see nothing happen.
    expect(result.state?.error).toBeTruthy();
  });
});
