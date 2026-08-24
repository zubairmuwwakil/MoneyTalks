import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { processWalletEvent } from "@/lib/domain/wallet/walletNormalization";
import { recoverIncompleteCapture } from "./actions";

vi.mock("@/lib/require-user", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/domain/wallet/walletNormalization", () => ({ processWalletEvent: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: vi.fn() },
}));

const tx = {
  walletEvent: { findFirst: vi.fn(), updateMany: vi.fn() },
  creditCard: { findFirst: vi.fn() },
  merchantAlias: { upsert: vi.fn() },
  cardAlias: { upsert: vi.fn() },
};

function validForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    eventId: "event-1",
    merchant: "Cafe Bleu",
    amount: "6.42",
    currency: "cad",
    cardId: "amex-cobalt",
    ...overrides,
  })) form.set(key, value);
  return form;
}

describe("recoverIncompleteCapture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
      const run = callback as unknown as (client: typeof tx) => Promise<unknown>;
      return run(tx) as never;
    });
    tx.walletEvent.findFirst.mockResolvedValue({
      id: "event-1",
      eventId: "wallet-event-1",
      processingStatus: "INCOMPLETE",
      purchaseId: null,
      merchantRaw: null,
      transactionNameRaw: null,
      cardRaw: "Wallet Cobalt",
      paymentMethodRaw: null,
    });
    tx.walletEvent.updateMany.mockResolvedValue({ count: 1 });
    tx.creditCard.findFirst.mockResolvedValue({ id: "owned-card" });
    vi.mocked(processWalletEvent).mockResolvedValue(true);
  });

  it("stores corrections separately, reuses aliases, and normalizes exactly once", async () => {
    await expect(recoverIncompleteCapture({}, validForm())).resolves.toEqual({
      ok: true,
      message: "Purchase recovered.",
    });

    expect(tx.walletEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "event-1", userId: "user-1" },
    }));
    expect(tx.merchantAlias.upsert).toHaveBeenCalledWith({
      where: { rawString: "Cafe Bleu" },
      create: { rawString: "Cafe Bleu", normalizedName: "Cafe Bleu" },
      update: { normalizedName: "Cafe Bleu" },
    });
    expect(tx.cardAlias.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_rawString: { userId: "user-1", rawString: "Wallet Cobalt" } },
    }));
    const update = tx.walletEvent.updateMany.mock.calls[0]?.[0];
    expect(update.data).toMatchObject({
      correctedMerchant: "Cafe Bleu",
      correctedAmount: new Prisma.Decimal("6.42"),
      correctedCurrency: "CAD",
      correctedCardId: "amex-cobalt",
      processingStatus: "OBSERVED",
    });
    expect(update.data).not.toHaveProperty("rawPayload");
    expect(update.data).not.toHaveProperty("merchantRaw");
    expect(update.data).not.toHaveProperty("amountRaw");
    expect(update.data).not.toHaveProperty("currencyRaw");
    expect(update.data).not.toHaveProperty("missingFields");
    expect(processWalletEvent).toHaveBeenCalledOnce();
    expect(processWalletEvent).toHaveBeenCalledWith("wallet-event-1");
  });

  it("is idempotent after another request has already recovered the event", async () => {
    tx.walletEvent.findFirst.mockResolvedValue({
      id: "event-1",
      eventId: "wallet-event-1",
      processingStatus: "NORMALIZED",
      purchaseId: "purchase-1",
      merchantRaw: null,
      transactionNameRaw: null,
      cardRaw: null,
      paymentMethodRaw: null,
    });

    await expect(recoverIncompleteCapture({}, validForm({ cardId: "" }))).resolves.toEqual({
      ok: true,
      message: "This capture was already recovered.",
    });
    expect(tx.walletEvent.updateMany).not.toHaveBeenCalled();
    expect(processWalletEvent).not.toHaveBeenCalled();
  });

  it("rejects an unowned card before writing aliases or corrections", async () => {
    tx.creditCard.findFirst.mockResolvedValue(null);

    const result = await recoverIncompleteCapture({}, validForm());

    expect(result.fieldErrors?.cardId).toBe("Choose one of your saved cards");
    expect(tx.merchantAlias.upsert).not.toHaveBeenCalled();
    expect(tx.walletEvent.updateMany).not.toHaveBeenCalled();
    expect(processWalletEvent).not.toHaveBeenCalled();
  });

  it("requires an explicit ISO currency instead of defaulting to CAD", async () => {
    const result = await recoverIncompleteCapture({}, validForm({ currency: "" }));

    expect(result.fieldErrors?.currency).toBe("Enter a 3-letter currency code");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
