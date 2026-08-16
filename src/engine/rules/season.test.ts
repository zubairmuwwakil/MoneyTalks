import { describe, expect, it } from "vitest";
import { makeProfile, makeSnapshot } from "./fixtures";
import { taxSeasonRule } from "./season";

describe("taxSeasonRule", () => {
  it("fires during filing season", () => {
    const alerts = taxSeasonRule.evaluate(makeProfile(), makeSnapshot([], { today: "2026-02-11" }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("info");
    expect(alerts[0].action).toContain("/money-finder/tax");
  });

  it("is silent outside it", () => {
    expect(taxSeasonRule.evaluate(makeProfile(), makeSnapshot([], { today: "2026-08-15" }))).toHaveLength(0);
  });
});
