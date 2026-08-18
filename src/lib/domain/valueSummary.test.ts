import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { convertMinorIfKnown } from "./valueSummary";

describe("convertMinorIfKnown", () => {
  it("returns null when currency is unknown", () => {
    expect(convertMinorIfKnown(10_000, null, "CAD", [])).toBeNull();
  });

  it("returns null instead of relabeling a foreign amount when FX is missing", () => {
    expect(convertMinorIfKnown(10_000, "USD", "CAD", [])).toBeNull();
  });

  it("converts when a matching FX rate exists", () => {
    expect(convertMinorIfKnown(10_000, "USD", "CAD", [
      { base: "USD", quote: "CAD", rate: 1.4, asOf: "2026-08-17" },
    ])).toBe(14_000);
  });
});
