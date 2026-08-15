import { describe, expect, it } from "vitest";
import { formatMinorUnits, minorToDollarInput, parseDollarsToMinor } from "./money";

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

describe("parseDollarsToMinor", () => {
  it("parses a plain amount", () => {
    expect(parseDollarsToMinor("45.00")).toBe(4_500);
  });

  it("parses thousands separators with a dollar sign", () => {
    expect(parseDollarsToMinor("$1,234.56")).toBe(123_456);
  });

  it("parses a parenthesised amount as negative", () => {
    expect(parseDollarsToMinor("(45.00)")).toBe(-4_500);
  });

  it("parses a leading-minus amount as negative", () => {
    expect(parseDollarsToMinor("-45.00")).toBe(-4_500);
  });

  it("parses a value with no decimals", () => {
    expect(parseDollarsToMinor("45")).toBe(4_500);
  });

  it("parses a value with a single decimal digit", () => {
    expect(parseDollarsToMinor("45.5")).toBe(4_550);
  });

  it("rejects unparseable input", () => {
    expect(parseDollarsToMinor("abc")).toBeNull();
    expect(parseDollarsToMinor("")).toBeNull();
    expect(parseDollarsToMinor("45.678")).toBeNull();
    expect(parseDollarsToMinor("12a34")).toBeNull();
    expect(parseDollarsToMinor("12-34")).toBeNull();
  });
});

describe("minorToDollarInput", () => {
  it("renders a plain dollars string with no symbol or grouping", () => {
    expect(minorToDollarInput(123_456)).toBe("1234.56");
  });

  it("renders zero", () => {
    expect(minorToDollarInput(0)).toBe("0.00");
  });

  it("renders negative amounts with a leading minus", () => {
    expect(minorToDollarInput(-4_500)).toBe("-45.00");
  });

  it("round-trips through parseDollarsToMinor", () => {
    expect(parseDollarsToMinor(minorToDollarInput(123_456))).toBe(123_456);
  });
});
