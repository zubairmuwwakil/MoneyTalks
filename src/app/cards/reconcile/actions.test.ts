import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { previewStatement } from "./actions";

vi.mock("@/lib/require-user", () => ({ requireUserId: vi.fn(async () => "user-1") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    creditCard: { findFirst: vi.fn(), update: vi.fn() },
    cardAlias: { findMany: vi.fn() },
    purchase: { findMany: vi.fn() },
    walletEvent: { findMany: vi.fn(), updateMany: vi.fn() },
    merchantAlias: { findMany: vi.fn() },
    statementLine: { findMany: vi.fn(), upsert: vi.fn() },
    coverageReport: { upsert: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// One tipped line: $58.50 posted against a $45.00 capture, inside the 25% band.
const CSV = "Date,Description,Amount\n2026-08-18,THE KEG STEAKHOUSE,58.50\n";

function statementUpload() {
  const data = new FormData();
  data.set("cardId", "card-1");
  data.set("contractCardId", "amex-cobalt");
  data.set("file", new File([CSV], "statement.csv", { type: "text/csv" }));
  data.set("dateCol", "0");
  data.set("amountCol", "2");
  data.set("descriptionCol", "1");
  data.set("dateFormat", "YMD");
  data.set("hasHeader", "true");
  return data;
}

function capture(currencyRaw: string | null) {
  return [
    {
      id: "we-1",
      eventId: "wevt-1",
      merchantRaw: "The Keg Steakhouse",
      amountRaw: new Prisma.Decimal(45),
      currencyRaw,
      capturedAt: new Date("2026-08-18T00:00:00Z"),
    },
  ];
}

async function reviewStatus() {
  const result = await previewStatement(statementUpload());
  if (!result.ok) throw new Error(result.error);
  return result.reviewLines[0]?.status ?? "matched";
}

describe("previewStatement currency gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.creditCard.findFirst).mockResolvedValue({
      id: "card-1", currency: "CAD", contractCardId: "amex-cobalt",
    } as never);
    vi.mocked(prisma.cardAlias.findMany).mockResolvedValue([{ rawString: "Amex Cobalt" }] as never);
    vi.mocked(prisma.purchase.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.merchantAlias.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.statementLine.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.$transaction).mockResolvedValue([] as never);
  });

  // Control: proves the fixture really does reach the tolerance rule, so the
  // currency test below cannot pass for the wrong reason.
  it("matches a same-currency capture to the tipped line", async () => {
    vi.mocked(prisma.walletEvent.findMany).mockResolvedValue(capture("CAD") as never);
    expect(await reviewStatus()).toBe("matched-tolerant");
  });

  it("refuses a USD capture against a CAD statement line", async () => {
    vi.mocked(prisma.walletEvent.findMany).mockResolvedValue(capture("USD") as never);
    expect(await reviewStatus()).toBe("unmatched");
  });

  it("refuses a capture with unknown currency against a CAD statement line", async () => {
    vi.mocked(prisma.walletEvent.findMany).mockResolvedValue(capture(null) as never);
    expect(await reviewStatus()).toBe("unmatched");
  });
});

describe("previewStatement pre-auth proposals", () => {
  // $47.30 settled against a $100.00 hold captured at the pump.
  const FUEL_CSV = "Date,Description,Amount\n2026-08-18,PETRO-CANADA,47.30\n";

  function fuelUpload() {
    const data = statementUpload();
    data.set("file", new File([FUEL_CSV], "statement.csv", { type: "text/csv" }));
    return data;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.creditCard.findFirst).mockResolvedValue({
      id: "card-1", currency: "CAD", contractCardId: "amex-cobalt",
    } as never);
    vi.mocked(prisma.cardAlias.findMany).mockResolvedValue([{ rawString: "Amex Cobalt" }] as never);
    vi.mocked(prisma.purchase.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.merchantAlias.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.statementLine.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.$transaction).mockResolvedValue([] as never);
    vi.mocked(prisma.walletEvent.findMany)
      .mockResolvedValueOnce([
        {
          id: "we-1", eventId: "wevt-1", merchantRaw: "Petro-Canada",
          amountRaw: new Prisma.Decimal(100), currencyRaw: "CAD",
          capturedAt: new Date("2026-08-18T00:00:00Z"),
        },
      ] as never)
      .mockResolvedValueOnce([{ id: "we-1", purchaseId: "purchase-1" }] as never);
  });

  it("persists the hold's candidate link on the statement line", async () => {
    await previewStatement(fuelUpload());
    expect(prisma.statementLine.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "matched-preauth", walletEventId: "we-1", purchaseId: "purchase-1",
        }),
      }),
    );
  });

  it("does not reconcile the wallet event behind an unconfirmed hold", async () => {
    await previewStatement(fuelUpload());
    expect(prisma.walletEvent.updateMany).not.toHaveBeenCalled();
  });
});
