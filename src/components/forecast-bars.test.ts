import { describe, expect, it } from "vitest";
import { formatForecastTooltip } from "./forecast-bars";

describe("formatForecastTooltip", () => {
  it("renders minor units as currency, keeping cents on whole-dollar months", () => {
    expect(formatForecastTooltip(368_500, "CAD")).toBe("$3,685.00");
    expect(formatForecastTooltip(500_000, "CAD")).toBe("$5,000.00");
  });

  it("renders a month with no bills due as zero", () => {
    expect(formatForecastTooltip(0, "CAD")).toBe("$0.00");
  });
});
