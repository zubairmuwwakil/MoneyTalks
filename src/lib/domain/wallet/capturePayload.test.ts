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

  it("fails closed when a decoded v2 amount is not a canonical decimal", () => {
    const parsed = parseWalletCapturePayload({
      ...base,
      transaction: { ...base.transaction, amountDecimal: "EC$17.49", amountDecodeStatus: "decoded" },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.amount).toBeNull();
    expect(parsed.data.amountDecodeStatus).toBe("undecodable");
  });
});

describe("schema 1 Wallet Shortcut display amounts", () => {
  const base = {
    schemaVersion: 1,
    shortcutVersion: 1,
    source: "apple_wallet_shortcuts",
    eventId: "legacy-xcd-1",
    capturedAt: "2026-08-22T14:23:34-04:00",
    transaction: { merchantRaw: "Massy Stores", amount: "EC$17.49", currency: "XCD" },
  } as const;

  it("uses the supplied ISO code to parse an ICU regional currency symbol", () => {
    const parsed = parseWalletCapturePayload(base);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.amount).toBe("17.49");
    expect(parsed.data.amountDecodeStatus).toBe("decoded");
  });

  it.each([
    ["XAF", "FCFA17.49"],
    ["JPY", "JP¥1749"],
  ])("parses other ICU currency labels when paired with %s", (currency, amount) => {
    const parsed = parseWalletCapturePayload({ ...base, transaction: { ...base.transaction, currency, amount } });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.amount).toBe(currency === "JPY" ? "1749" : "17.49");
  });

  it("refuses a regional symbol that does not match the supplied ISO code", () => {
    const parsed = parseWalletCapturePayload({ ...base, transaction: { ...base.transaction, currency: "CAD" } });
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.data.amount).toBeNull();
    expect(parsed.ok && parsed.data.amountDecodeStatus).toBe("undecodable");
  });
});
