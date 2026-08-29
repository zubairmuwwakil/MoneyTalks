import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  accountNumberLastFour,
  maskBillAccountNumber,
  protectBillAccountNumber,
  revealBillAccountNumber,
} from "./accountNumber";

describe("bill account-number protection", () => {
  const savedVersion = process.env.SECRET_ENC_ACTIVE_VERSION;
  const savedKey = process.env.SECRET_ENC_KEY_V1;

  beforeEach(() => {
    process.env.SECRET_ENC_ACTIVE_VERSION = "1";
    process.env.SECRET_ENC_KEY_V1 = randomBytes(32).toString("base64");
  });

  afterEach(() => {
    if (savedVersion === undefined) delete process.env.SECRET_ENC_ACTIVE_VERSION;
    else process.env.SECRET_ENC_ACTIVE_VERSION = savedVersion;
    if (savedKey === undefined) delete process.env.SECRET_ENC_KEY_V1;
    else process.env.SECRET_ENC_KEY_V1 = savedKey;
  });

  it("preserves the entered value while exposing only a display suffix", () => {
    const protectedValue = protectBillAccountNumber("  5849-01-0027  ", "user-1", "bill-1");

    expect(protectedValue.encrypted).not.toContain("5849-01-0027");
    expect(protectedValue.lastFour).toBe("0027");
    expect(revealBillAccountNumber(protectedValue.encrypted, "user-1", "bill-1")).toBe("5849-01-0027");
    expect(maskBillAccountNumber(protectedValue.lastFour)).toBe("•••• 0027");
  });

  it("derives the last four from letters and digits, not separators", () => {
    expect(accountNumberLastFour("POL-AB-9912")).toBe("9912");
    expect(accountNumberLastFour("AB-CD")).toBe("ABCD");
  });

  it("cannot decrypt a value for a different bill", () => {
    const protectedValue = protectBillAccountNumber("123456789", "user-1", "bill-1");
    expect(() => revealBillAccountNumber(protectedValue.encrypted, "user-1", "bill-2")).toThrow();
  });
});
