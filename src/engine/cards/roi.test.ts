import { describe, expect, it } from "vitest";
import { FIXTURE_CARDS } from "./fixtures";
import { cardVerdict, cheatSheet } from "./roi";

const [alpha, beta, gamma] = FIXTURE_CARDS;
const today = "2026-08-15";

describe("cheatSheet", () => {
  it("maps every category to its default best card", () => {
    const sheet = cheatSheet(FIXTURE_CARDS, today);
    const by = Object.fromEntries(sheet.map((row) => [row.category, row]));
    expect(by.dining.best?.cardId).toBe("alpha");
    expect(by.groceries.best?.cardId).toBe("alpha");
    expect(by.groceries.runnerUp?.cardId).toBe("beta");
    expect(by.everything_else.best?.cardId).toBe("gamma");
    expect(by.online_foreign.best?.cardId).toBe("gamma");
    expect(sheet).toHaveLength(11);
  });
});

describe("cardVerdict", () => {
  it("keeps a no-fee card unconditionally", () => {
    expect(cardVerdict(beta, [], 0, false, today).verdict).toBe("KEEP");
  });

  it("keeps a fee card whose realized value covers the fee", () => {
    const v = cardVerdict(alpha, [{ creditId: "dine100", periodKey: "2026" }], 6_000, true, today);
    expect(v.realizedMinor).toBe(16_000);
    expect(v.netMinor).toBe(1_000);
    expect(v.verdict).toBe("KEEP");
  });

  it("downgrades a losing card that still wins somewhere", () => {
    const v = cardVerdict(alpha, [{ creditId: "dine100", periodKey: "2026" }], 4_000, true, today);
    expect(v.netMinor).toBe(-1_000);
    expect(v.verdict).toBe("DOWNGRADE");
  });

  it("cancel-candidates a losing card that wins nowhere", () => {
    const v = cardVerdict(gamma, [], 0, false, today);
    expect(v.netMinor).toBe(-12_000);
    expect(v.verdict).toBe("CANCEL_CANDIDATE");
  });

  it("ignores credits redeemed in other periods", () => {
    const v = cardVerdict(alpha, [{ creditId: "dine100", periodKey: "2025" }], 0, true, today);
    expect(v.realizedMinor).toBe(0);
  });
});
