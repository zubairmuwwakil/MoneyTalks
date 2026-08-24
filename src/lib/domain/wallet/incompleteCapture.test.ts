import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { toIncompleteCaptureEvidence } from "./incompleteCapture";

vi.mock("@/lib/prisma", () => ({ prisma: { walletEvent: { findMany: vi.fn() } } }));

describe("toIncompleteCaptureEvidence", () => {
  it("returns only bounded correction hints and excludes sensitive raw capture data", () => {
    const evidence = toIncompleteCaptureEvidence({
      id: "event-1",
      capturedAt: new Date("2026-08-23T14:00:00Z"),
      source: "apple_wallet_automation",
      schemaVersion: 2,
      merchantRaw: "Cafe\u0000 Bleu",
      transactionNameRaw: null,
      merchantNormalized: null,
      amountRaw: null,
      amountTextRaw: "$6.42",
      amountDeviceDecimal: new Prisma.Decimal("6.42"),
      amountDecodeStatus: "undecodable",
      amountDisagreement: true,
      currencyRaw: null,
      cardRaw: "Wallet card",
      paymentMethodRaw: null,
      paymentMethodFallback: false,
      resolvedCardId: null,
      correctedMerchant: null,
      correctedAmount: null,
      correctedCurrency: null,
      correctedCardId: null,
      missingFields: ["amountDecimal", "currencyRaw"],
      walletInstallation: { label: "My iPhone" },
      // These emulate fields on the database row. The DTO must ignore them.
      rawPayload: { secret: "raw-secret" },
      clientMetadata: { device: "private-device" },
      latitude: 43.65,
      longitude: -79.38,
    } as never);

    expect(evidence).toMatchObject({
      merchantHint: "Cafe Bleu",
      amountHint: "$6.42",
      currencyHint: null,
      cardHint: "Wallet card",
      missing: ["amount", "currency"],
      defaults: { merchant: "Cafe Bleu", amount: "", currency: "", cardId: "" },
    });
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain("raw-secret");
    expect(serialized).not.toContain("private-device");
    expect(serialized).not.toContain("43.65");
  });
});
