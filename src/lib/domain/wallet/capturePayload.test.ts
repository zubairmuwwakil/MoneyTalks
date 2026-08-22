import { describe, expect, it } from "vitest";
import { parseWalletCapturePayload } from "./capturePayload";

describe("schema 2 Wallet capture payload", () => {
  const base = {
    schemaVersion: 2,
    captureVersion: 1,
    source: "apple_wallet_automation",
    transport: "pickme_app_intent",
    eventId: "AA3A0467-19B5-4F50-9548-CAF81CC99CFF",
    capturedAt: "2026-08-22T14:23:34-04:00",
    timezone: "America/St_Lucia",
    transaction: {
      merchantRaw: "Massy Stores (slu) L",
      transactionNameRaw: "Massy Stores (slu) L",
      amountRaw: "EC$17.49",
      amountDecimal: "17.49",
      amountDecodeStatus: "decoded",
      currencyRaw: "XCD",
      cardRaw: "Scotiabank Visa Card",
      paymentMethodRaw: "Massy Stores (slu) L",
    },
    client: { appVersion: "1", locale: "en_CA" },
  } as const;

  it("prefers the device-decoded decimal while preserving foreign-currency raw text", () => {
    const parsed = parseWalletCapturePayload(base);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.amount).toBe("17.49");
    expect(parsed.data.amountTextRaw).toBe("EC$17.49");
    expect(parsed.data.currency).toBe("XCD");
    expect(parsed.data.amountDecodeStatus).toBe("decoded");
  });

  it("discards the Payment Method entity fallback when it equals transaction Name", () => {
    const parsed = parseWalletCapturePayload(base);
    expect(parsed.ok && parsed.data.paymentMethodRaw).toBeNull();
    expect(parsed.ok && parsed.data.paymentMethodFallback).toBe(true);
  });

  it("flags a device/server amount disagreement without rejecting the event", () => {
    const payload = { ...base, transaction: { ...base.transaction, amountRaw: "$1,234.56", amountDecimal: "123.45" } };
    const parsed = parseWalletCapturePayload(payload);
    expect(parsed.ok && parsed.data.amount).toBe("123.45");
    expect(parsed.ok && parsed.data.amountDisagreement).toBe(true);
  });

  it("keeps genuinely absent amounts distinct from undecodable amounts", () => {
    const absent = parseWalletCapturePayload({ ...base, transaction: { ...base.transaction, amountRaw: null, amountDecimal: null, amountDecodeStatus: "absent" } });
    const bad = parseWalletCapturePayload({ ...base, transaction: { ...base.transaction, amountRaw: "??", amountDecimal: null, amountDecodeStatus: "undecodable" } });
    expect(absent.ok && absent.data.amountDecodeStatus).toBe("absent");
    expect(bad.ok && bad.data.amountDecodeStatus).toBe("undecodable");
  });
});
