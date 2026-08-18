import { describe, expect, it } from "vitest";

import { formatMoney } from "./calendarEvents";

describe("formatMoney", () => {
  it("labels an amount whose currency is unknown without inventing a symbol", () => {
    expect(formatMoney(4_299, null)).toBe("42.99 (currency unknown)");
  });

  it("keeps localized formatting when the currency is known", () => {
    expect(formatMoney(4_299, "CAD")).toContain("42.99");
  });
});
