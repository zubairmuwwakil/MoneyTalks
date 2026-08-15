import { describe, expect, it } from "vitest";
import { formatNetWorthTooltip } from "./net-worth-sparkline";

describe("formatNetWorthTooltip", () => {
  it("formats minor units in the selected display currency", () => {
    expect(formatNetWorthTooltip(123456, "CAD")).toBe("$1,234.56");
    expect(formatNetWorthTooltip(123456, "USD")).not.toBe(
      formatNetWorthTooltip(123456, "CAD"),
    );
    expect(formatNetWorthTooltip(123456, "JMD")).not.toBe(
      formatNetWorthTooltip(123456, "CAD"),
    );
  });
});
