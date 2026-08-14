import { describe, expect, it } from "vitest";
import { formatMinorUnits } from "./money";

describe("formatMinorUnits", () => {
  it("formats CAD cents as dollars", () => {
    expect(formatMinorUnits(123456, "CAD")).toBe("$1,234.56");
  });

  it("formats zero", () => {
    expect(formatMinorUnits(0, "CAD")).toBe("$0.00");
  });

  it("formats negative amounts", () => {
    expect(formatMinorUnits(-9900, "CAD")).toBe("-$99.00");
  });

  it("distinguishes USD in a Canadian locale", () => {
    expect(formatMinorUnits(123456, "USD")).toContain("1,234.56");
    expect(formatMinorUnits(123456, "USD")).not.toBe(
      formatMinorUnits(123456, "CAD"),
    );
  });

  it("rejects non-integer input", () => {
    expect(() => formatMinorUnits(12.34, "CAD")).toThrow(RangeError);
  });

  it("rejects unsafe integers", () => {
    expect(() =>
      formatMinorUnits(Number.MAX_SAFE_INTEGER + 1, "CAD"),
    ).toThrow(RangeError);
  });
});
