import { describe, expect, it } from "vitest";
import { formatSignedMinor, formatSignedPercent } from "./performance-format";

describe("investment performance formatters", () => {
  it("formats signed currency with an explicit positive sign", () => {
    expect(formatSignedMinor(12_345, "CAD")).toBe("+$123.45");
    expect(formatSignedMinor(-12_345, "CAD")).toBe("-$123.45");
  });

  it("does not imply direction for a measured zero", () => {
    expect(formatSignedMinor(0, "CAD")).toBe("$0.00");
    expect(formatSignedPercent(0)).toBe("0.0%");
  });

  it("formats signed percentages and unknown values", () => {
    expect(formatSignedPercent(0.042)).toBe("+4.2%");
    expect(formatSignedPercent(-0.031)).toBe("-3.1%");
    expect(formatSignedPercent(null)).toBe("—");
    expect(formatSignedMinor(null, "CAD")).toBe("—");
  });
});
